package main

import (
	"crypto/tls"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"github.com/domodwyer/mailyak/v3"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/mails"
	"github.com/pocketbase/pocketbase/tools/mailer"
	"github.com/pocketbase/pocketbase/tools/security"
)

// PocketBase sends some emails (password reset, email confirmation) in the
// background after answering the request, and only records a failure in its
// own log table, which a server not run with --dev never prints. So every
// email the server sends goes through logMail: the outcome is printed to the
// container log, and an email is refused outright when no mail server is
// set, instead of PocketBase quietly trying a sendmail program the container
// doesn't have.
func logMail(app core.App, cfg Config) {
	app.OnMailerSend().BindFunc(func(e *core.MailerEvent) error {
		if c, ok := e.Mailer.(*mailer.SMTPClient); ok && c.AuthMethod != mailer.SMTPAuthLogin {
			e.Mailer = &smtpSender{SMTPClient: *c, noStartTLS: cfg.Mail.NoStartTLS, skipVerify: cfg.Mail.SkipVerify}
		}
		to := recipients(e)
		subject := ""
		if e.Message != nil {
			subject = e.Message.Subject
		}
		if !e.App.Settings().SMTP.Enabled {
			err := errors.New("email isn't set up on this server (set SMTP_HOST and MAIL_FROM_ADDRESS in .env, or the mail settings on the admin Server settings screen)")
			log.Printf("email %q to %s not sent: %v", subject, to, err)
			return err
		}
		err := e.Next()
		if err != nil {
			log.Printf("email %q to %s failed: %v", subject, to, err)
			e.App.Logger().Error("email failed", "subject", subject, "to", to, "error", err)
			return err
		}
		log.Printf("email %q sent to %s", subject, to)
		return nil
	})
}

func recipients(e *core.MailerEvent) string {
	if e.Message == nil {
		return "nobody"
	}
	to := make([]string, 0, len(e.Message.To))
	for _, a := range e.Message.To {
		to = append(to, a.Address)
	}
	return strings.Join(to, ", ")
}

// mailProblem says why emails with a link back to the server can't go out
// yet, or "" when they can.
func mailProblem(app core.App) string {
	s := app.Settings()
	if !s.SMTP.Enabled {
		return "Email isn't set up on this server, so the email can't be sent. Set SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD and MAIL_FROM_ADDRESS in the server's .env and restart it."
	}
	if strings.TrimSpace(s.Meta.SenderAddress) == "" {
		return "The server has no address to send email from. Set MAIL_FROM_ADDRESS in the server's .env and restart it."
	}
	if u := strings.TrimSpace(s.Meta.AppURL); u == "" || strings.Contains(u, "localhost") || strings.Contains(u, "127.0.0.1") {
		return "The server doesn't know its own web address, so the link in the email wouldn't work. Set PUBLIC_URL (like https://whereis.example.com) in the server's .env and restart it."
	}
	return ""
}

// verifyResendWait is how long someone waits before asking for another
// confirmation email.
const verifyResendWait = time.Minute

// sendVerifyEmail sends the signed-in person a link that confirms their
// email address. Unlike PocketBase's own request-verification endpoint, it
// sends straight away and answers with the mail server's error if there is one.
func sendVerifyEmail(e *core.RequestEvent) error {
	u := e.Auth
	if u.Verified() {
		return e.JSON(http.StatusOK, map[string]any{"verified": true})
	}
	if u.Email() == "" {
		return e.BadRequestError("Your account has no email address.", nil)
	}
	if p := mailProblem(e.App); p != "" {
		log.Printf("confirmation email for %s not sent: %s", u.Email(), p)
		return e.BadRequestError(p, nil)
	}
	key := "whereis-verify-" + u.Id
	if sent, ok := e.App.Store().GetOk(key); ok {
		if at, _ := sent.(time.Time); time.Since(at) < verifyResendWait {
			wait := int((verifyResendWait - time.Since(at)).Seconds()) + 1
			return e.TooManyRequestsError(fmt.Sprintf("A confirmation email was sent a moment ago. Check your spam folder, or try again in %d seconds.", wait), nil)
		}
	}
	if err := mails.SendRecordVerification(e.App, u); err != nil {
		// logMail has already printed the mail server's answer
		return e.BadRequestError("The mail server didn't take the email: "+err.Error(), nil)
	}
	e.App.Store().Set(key, time.Now())
	return e.JSON(http.StatusOK, map[string]any{"verified": false, "to": u.Email()})
}

// smtpSender sends like PocketBase's SMTP client, with three differences:
// it gives up after a while instead of waiting forever on a mail server that
// doesn't answer, it can skip STARTTLS (SMTP_STARTTLS=false), and it can
// accept an internal server's self-signed certificate (SMTP_TLS_VERIFY=false).
// With no username and password it sends without logging in, as PocketBase
// does.
type smtpSender struct {
	mailer.SMTPClient
	noStartTLS bool
	skipVerify bool
}

// smtpTimeout bounds one whole send, from connecting to the final reply.
var smtpTimeout = 30 * time.Second

func (c *smtpSender) Send(m *mailer.Message) error {
	yak := mailyak.New("", nil) // only used to build the message
	if m.From.Name != "" {
		yak.FromName(m.From.Name)
	}
	yak.From(m.From.Address)
	yak.Subject(m.Subject)
	yak.HTML().Set(m.HTML)
	if m.Text != "" {
		yak.Plain().Set(m.Text)
	}
	var rcpt []string
	for _, list := range [][]mail.Address{m.To, m.Cc, m.Bcc} {
		for _, a := range list {
			rcpt = append(rcpt, a.Address)
		}
	}
	if len(m.To) > 0 {
		yak.To(addressList(m.To)...)
	}
	if len(m.Cc) > 0 {
		yak.Cc(addressList(m.Cc)...)
	}
	for name, r := range m.Attachments {
		yak.Attach(name, r)
	}
	for name, r := range m.InlineAttachments {
		yak.AttachInline(name, r)
	}
	hasID := false
	for k, v := range m.Headers {
		hasID = hasID || strings.EqualFold(k, "Message-ID")
		yak.AddHeader(k, v)
	}
	if _, domain, ok := strings.Cut(m.From.Address, "@"); ok && !hasID {
		yak.AddHeader("Message-ID", "<"+security.PseudorandomString(15)+"@"+domain+">")
	}
	body, err := yak.MimeBuf()
	if err != nil {
		return err
	}
	if len(rcpt) == 0 {
		return errors.New("the email has no recipients")
	}

	addr := net.JoinHostPort(c.Host, strconv.Itoa(c.Port))
	tlsConfig := &tls.Config{ServerName: c.Host, InsecureSkipVerify: c.skipVerify} //nolint:gosec // only when SMTP_TLS_VERIFY=false
	dialer := &net.Dialer{Timeout: 15 * time.Second}
	var conn net.Conn
	if c.TLS {
		conn, err = tls.DialWithDialer(dialer, "tcp", addr, tlsConfig)
	} else {
		conn, err = dialer.Dial("tcp", addr)
	}
	if err != nil {
		return fmt.Errorf("couldn't connect to the mail server %s: %w", addr, err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(smtpTimeout))

	client, err := smtp.NewClient(conn, c.Host)
	if err != nil {
		return fmt.Errorf("the mail server %s didn't greet us: %w", addr, err)
	}
	defer client.Close()
	if c.LocalName != "" {
		if err := client.Hello(c.LocalName); err != nil {
			return err
		}
	}
	if !c.TLS && !c.noStartTLS {
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(tlsConfig); err != nil {
				return fmt.Errorf("STARTTLS with the mail server failed (for an internal server with its own certificate, set SMTP_TLS_VERIFY=false, or SMTP_STARTTLS=false to send without it): %w", err)
			}
		}
	}
	if c.Username != "" || c.Password != "" {
		if err := client.Auth(smtp.PlainAuth("", c.Username, c.Password, c.Host)); err != nil {
			return fmt.Errorf("the mail server didn't accept the username and password: %w", err)
		}
	}
	if err := client.Mail(m.From.Address); err != nil {
		return fmt.Errorf("the mail server refused the from address %s: %w", m.From.Address, err)
	}
	for _, to := range rcpt {
		if err := client.Rcpt(to); err != nil {
			return fmt.Errorf("the mail server refused to send to %s (if it only relays for some senders, allow this server's address): %w", to, err)
		}
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(body.Bytes()); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return client.Quit()
}

func addressList(list []mail.Address) []string {
	out := make([]string, 0, len(list))
	for _, a := range list {
		out = append(out, a.String())
	}
	return out
}
