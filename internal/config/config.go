package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

type Config struct {
	URL         string `json:"url"`
	APIKey      string `json:"apiKey"`
	APISecret   string `json:"apiSecret"`
	DisplayName string `json:"displayName"`
}

type ResolvedServer struct {
	SignalURL string
	APIURL    string
}

const (
	publicLiveKitHost = "179.90.226.218"
	lanLiveKitHost    = "192.168.15.2"
	DefaultURL        = "ws://" + publicLiveKitHost + ":7880"
	lanURL            = "ws://" + lanLiveKitHost + ":7880"
	DefaultKey        = ""
	DefaultSecret     = ""
)

var roomName = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func Load() Config {
	raw, err := os.ReadFile(path())
	if err != nil {
		return Config{URL: defaultURL(), APIKey: DefaultKey, APISecret: DefaultSecret}
	}
	var stored Config
	if json.Unmarshal(raw, &stored) != nil {
		return Config{URL: defaultURL(), APIKey: DefaultKey, APISecret: DefaultSecret}
	}
	return normalize(stored)
}

func Save(cfg Config) (Config, error) {
	next, err := Validate(cfg)
	if err != nil {
		return Config{}, err
	}
	dir := filepath.Dir(path())
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Config{}, err
	}
	data, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return Config{}, err
	}
	if err := os.WriteFile(path(), data, 0o644); err != nil {
		return Config{}, err
	}
	return next, nil
}

func Validate(cfg Config) (Config, error) {
	resolved, err := ResolveServer(strings.TrimSpace(cfg.URL))
	if err != nil {
		return Config{}, err
	}
	key, err := requireCredential(cfg.APIKey, "API key")
	if err != nil {
		return Config{}, err
	}
	secret, err := requireCredential(cfg.APISecret, "API secret")
	if err != nil {
		return Config{}, err
	}
	name := strings.TrimSpace(cfg.DisplayName)
	if name != "" {
		name, err = RequireDisplayName(name)
		if err != nil {
			return Config{}, err
		}
	}
	return Config{
		URL:         rewriteLiveKitHost(resolved.SignalURL),
		APIKey:      key,
		APISecret:   secret,
		DisplayName: name,
	}, nil
}

func defaultURL() string {
	if isAdmin() {
		return lanURL
	}
	return DefaultURL
}

func rewriteLiveKitHost(url string) string {
	if !isAdmin() {
		return url
	}
	return strings.ReplaceAll(url, publicLiveKitHost, lanLiveKitHost)
}

func isAdmin() bool {
	candidates := []string{os.Getenv("HOME"), os.Getenv("USERPROFILE")}
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append(candidates, home)
	}
	for _, p := range candidates {
		n := strings.ToLower(filepath.ToSlash(strings.TrimSpace(p)))
		if i := strings.Index(n, "/users/admin"); i >= 0 {
			rest := n[i+len("/users/admin"):]
			if rest == "" || strings.HasPrefix(rest, "/") {
				return true
			}
		}
	}
	user := strings.ToLower(strings.TrimSpace(os.Getenv("USER")))
	if user == "" {
		user = strings.ToLower(strings.TrimSpace(os.Getenv("USERNAME")))
	}
	return user == "admin"
}

func ResolveServer(input string) (ResolvedServer, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(input), "/")
	signal := trimmed
	switch {
	case strings.HasPrefix(signal, "https://"):
		signal = "wss://" + strings.TrimPrefix(signal, "https://")
	case strings.HasPrefix(signal, "http://"):
		signal = "ws://" + strings.TrimPrefix(signal, "http://")
	}
	if !strings.HasPrefix(signal, "ws://") && !strings.HasPrefix(signal, "wss://") {
		return ResolvedServer{}, errors.New("Server URL must look like ws://host:7880")
	}
	rest := signal
	if strings.HasPrefix(rest, "wss://") {
		rest = strings.TrimPrefix(rest, "wss://")
	} else {
		rest = strings.TrimPrefix(rest, "ws://")
	}
	if rest == "" || strings.ContainsAny(rest, "/ ") {
		return ResolvedServer{}, errors.New("Server URL must look like ws://host:7880")
	}
	api := "http://" + rest
	if strings.HasPrefix(signal, "wss://") {
		api = "https://" + rest
	}
	return ResolvedServer{SignalURL: signal, APIURL: api}, nil
}

func RequireDisplayName(value string) (string, error) {
	name := strings.TrimSpace(value)
	if name == "" {
		return "", errors.New("Enter your name")
	}
	if utf8.RuneCountInString(name) > 40 {
		return "", errors.New("Name must be 40 characters or less")
	}
	for _, r := range name {
		if r < 32 || r == 127 {
			return "", errors.New("Name has invalid characters")
		}
	}
	return name, nil
}

func RequireRoom(value string) (string, error) {
	room := strings.TrimSpace(value)
	if !roomName.MatchString(room) {
		return "", errors.New("Room name can use letters, numbers, dashes, and underscores")
	}
	return room, nil
}

func path() string {
	root, err := os.UserConfigDir()
	if err != nil {
		root = os.TempDir()
	}
	return filepath.Join(root, "WelfareOffice", "config.json")
}

func normalize(stored Config) Config {
	url := strings.TrimSpace(stored.URL)
	if url == "" {
		url = defaultURL()
	}
	signal := defaultURL()
	if resolved, err := ResolveServer(url); err == nil {
		signal = rewriteLiveKitHost(resolved.SignalURL)
	}
	key := strings.TrimSpace(stored.APIKey)
	if key == "" {
		key = DefaultKey
	}
	secret := strings.TrimSpace(stored.APISecret)
	if secret == "" {
		secret = DefaultSecret
	}
	return Config{
		URL:         signal,
		APIKey:      key,
		APISecret:   secret,
		DisplayName: strings.TrimSpace(stored.DisplayName),
	}
}

func requireCredential(value, label string) (string, error) {
	cred := strings.TrimSpace(value)
	if cred == "" {
		return "", errors.New(label + " is required")
	}
	if len(cred) > 256 {
		return "", errors.New(label + " is too long")
	}
	return cred, nil
}
