package main

import (
	"bufio"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"net"
	"net/mail"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tools/mailer"
)

// fakeSMTP is a tiny mail server like one on a home network: port 25 style,
// no login, and optionally STARTTLS with a self-signed certificate.
type fakeSMTP struct {
	addr     string
	startTLS bool
	mu       sync.Mutex
	commands []string
	data     string
	tls      bool
}

func newFakeSMTP(t *testing.T, startTLS bool) *fakeSMTP {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	f := &fakeSMTP{addr: ln.Addr().String(), startTLS: startTLS}
	cert := selfSigned(t)
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go f.serve(conn, cert)
		}
	}()
	return f
}

func (f *fakeSMTP) serve(conn net.Conn, cert tls.Certificate) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	r, w := bufio.NewReader(conn), conn
	say := func(s string) { _, _ = w.Write([]byte(s + "\r\n")) }
	say("220 mail.home ESMTP")
	inData := false
	var body strings.Builder
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		if inData {
			if line == "." {
				inData = false
				f.mu.Lock()
				f.data = body.String()
				f.mu.Unlock()
				say("250 queued")
				continue
			}
			body.WriteString(line + "\n")
			continue
		}
		f.mu.Lock()
		f.commands = append(f.commands, line)
		secure := f.tls
		f.mu.Unlock()
		cmd := strings.ToUpper(strings.SplitN(line, " ", 2)[0])
		switch cmd {
		case "EHLO", "HELO":
			if f.startTLS && !secure {
				say("250-mail.home")
				say("250 STARTTLS")
			} else {
				say("250 mail.home")
			}
		case "STARTTLS":
			say("220 go ahead")
			tc := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{cert}})
			if err := tc.Handshake(); err != nil {
				return
			}
			f.mu.Lock()
			f.tls = true
			f.mu.Unlock()
			r, w = bufio.NewReader(tc), tc
		case "AUTH":
			say("503 no auth here")
		case "MAIL", "RCPT", "RSET", "NOOP":
			say("250 ok")
		case "DATA":
			inData = true
			say("354 go on")
		case "QUIT":
			say("221 bye")
			return
		default:
			say("502 what")
		}
	}
}

func (f *fakeSMTP) seen() (cmds []string, data string, secure bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.commands...), f.data, f.tls
}

func selfSigned(t *testing.T) tls.Certificate {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "mail.home"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		IPAddresses: []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

func sendVia(t *testing.T, f *fakeSMTP, noStartTLS, skipVerify bool) error {
	t.Helper()
	host, portStr, _ := net.SplitHostPort(f.addr)
	port, _ := strconv.Atoi(portStr)
	s := &smtpSender{SMTPClient: mailer.SMTPClient{Host: host, Port: port}, noStartTLS: noStartTLS, skipVerify: skipVerify}
	return s.Send(&mailer.Message{
		From:    mail.Address{Name: "Where Is", Address: "whereis@home.lan"},
		To:      []mail.Address{{Address: "sam@home.lan"}},
		Subject: "Confirm your email",
		HTML:    "<p>Click the link</p>",
	})
}

func TestSMTPNoLogin(t *testing.T) {
	f := newFakeSMTP(t, false)
	if err := sendVia(t, f, false, false); err != nil {
		t.Fatal(err)
	}
	cmds, data, _ := f.seen()
	joined := strings.Join(cmds, "\n")
	if strings.Contains(joined, "AUTH") {
		t.Fatalf("logged in with no username: %s", joined)
	}
	if !strings.Contains(joined, "MAIL FROM:<whereis@home.lan>") || !strings.Contains(joined, "RCPT TO:<sam@home.lan>") {
		t.Fatalf("commands: %s", joined)
	}
	if !strings.Contains(data, "Subject: Confirm your email") || !strings.Contains(data, "Click the link") {
		t.Fatalf("message: %s", data)
	}
}

func TestSMTPSelfSignedStartTLS(t *testing.T) {
	f := newFakeSMTP(t, true)
	err := sendVia(t, f, false, false)
	if err == nil || !strings.Contains(err.Error(), "SMTP_TLS_VERIFY=false") {
		t.Fatalf("want a certificate error naming the fix, got %v", err)
	}

	f = newFakeSMTP(t, true)
	if err := sendVia(t, f, false, true); err != nil {
		t.Fatal(err)
	}
	if _, data, secure := f.seen(); !secure || data == "" {
		t.Fatalf("SMTP_TLS_VERIFY=false: secure %v, data %q", secure, data)
	}

	f = newFakeSMTP(t, true)
	if err := sendVia(t, f, true, false); err != nil {
		t.Fatal(err)
	}
	if cmds, data, secure := f.seen(); secure || data == "" || strings.Contains(strings.Join(cmds, " "), "STARTTLS") {
		t.Fatalf("SMTP_STARTTLS=false: secure %v, cmds %v", secure, cmds)
	}
}

func TestSMTPUnreachableTimesOut(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		// accept and never answer
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			defer c.Close()
		}
	}()
	old := smtpTimeout
	smtpTimeout = 300 * time.Millisecond
	defer func() { smtpTimeout = old }()
	f := &fakeSMTP{addr: ln.Addr().String()}
	start := time.Now()
	if err := sendVia(t, f, false, false); err == nil {
		t.Fatal("want an error")
	}
	if time.Since(start) > 5*time.Second {
		t.Fatal("didn't give up")
	}
}

func TestMailEnvOptions(t *testing.T) {
	env := map[string]string{"SMTP_HOST": "mail.home.lan", "SMTP_PORT": "25", "SMTP_STARTTLS": "false", "SMTP_TLS_VERIFY": "false", "MAIL_FROM_ADDRESS": "whereis@home.lan"}
	c := ConfigFromEnv(func(k string) string { return env[k] }).Mail
	if c.Port != 25 || c.TLS || !c.NoStartTLS || !c.SkipVerify || c.Username != "" {
		t.Fatalf("%+v", c)
	}
	d := ConfigFromEnv(func(k string) string { return "" }).Mail
	if d.NoStartTLS || d.SkipVerify {
		t.Fatalf("defaults: %+v", d)
	}
}
