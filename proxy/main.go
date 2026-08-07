// forgerie-tsnet — the app's own tailnet node. Joins the tailnet as
// "forgerie" (so the app lives at https://forgerie.<tailnet>.ts.net,
// independent of the machine's hostname) and reverse-proxies to the local
// Forgerie web/API server. HTTPS certs come from tailscale automatically;
// :80 redirects to the canonical https name. Tailnet-only — nothing is
// funneled to the internet.
//
// First run: authorize the new node once via the URL this logs (or set
// TS_AUTHKEY). State persists under --state.
package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"tailscale.com/tsnet"
)

func main() {
	name := flag.String("name", "forgerie", "tailnet hostname for this node")
	upstream := flag.String("upstream", "http://127.0.0.1:8504", "Forgerie web server to proxy")
	state := flag.String("state", defaultState(), "tsnet state directory")
	flag.Parse()

	if err := os.MkdirAll(*state, 0o700); err != nil {
		log.Fatal(err)
	}
	s := &tsnet.Server{Hostname: *name, Dir: *state}
	defer s.Close()

	// Generous: the first start waits for a human to click the authorize
	// URL — restarting would mint a new URL and invalidate the one shown.
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Hour)
	defer cancel()
	status, err := s.Up(ctx)
	if err != nil {
		log.Fatal(err)
	}
	fqdn := strings.TrimSuffix(status.Self.DNSName, ".")
	log.Printf("forgerie-tsnet: %s → %s", fqdn, *upstream)

	target, err := url.Parse(*upstream)
	if err != nil {
		log.Fatal(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(target)

	// :80 → the canonical https name (covers typing the MagicDNS shortname).
	go func() {
		ln, err := s.Listen("tcp", ":80")
		if err != nil {
			log.Printf("forgerie-tsnet: http listener: %v", err)
			return
		}
		_ = http.Serve(ln, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, "https://"+fqdn+r.URL.RequestURI(), http.StatusTemporaryRedirect)
		}))
	}()

	ln, err := s.ListenTLS("tcp", ":443")
	if err != nil {
		log.Fatal(err)
	}
	log.Fatal(http.Serve(ln, proxy))
}

func defaultState() string {
	if dir, err := os.UserConfigDir(); err == nil {
		return filepath.Join(dir, "forgerie-tsnet")
	}
	return "./forgerie-tsnet-state"
}
