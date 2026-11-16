package main

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/mails"
)

// PocketBase sends some emails (password reset, email confirmation) in the
// background after answering the request, and only records a failure in its
// own log table, which a server not run with --dev never prints. So every
// email the server sends goes through logMail: the outcome is printed to the
// container log, and an email is refused outright when no mail server is
// set, instead of PocketBase quietly trying a sendmail program the container
// doesn't have.
func logMail(app core.App) {
	app.OnMailerSend().BindFunc(func(e *core.MailerEvent) error {
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
