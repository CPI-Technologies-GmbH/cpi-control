package statuspage

// Config holds the configuration for all status pages.
type Config struct {
	Pages []PageConfig `json:"pages"`
}

// PageConfig defines a single public status page.
type PageConfig struct {
	ID       string          `json:"id"`
	Domain   string          `json:"domain"`
	Theme    string          `json:"theme"` // dark, light, minimal
	Branding BrandingConfig  `json:"branding"`
	Projects []ProjectConfig `json:"projects"`
}

// BrandingConfig holds brand customization for a status page.
type BrandingConfig struct {
	LogoURL      string `json:"logo_url"`
	PrimaryColor string `json:"primary_color"`
	CompanyName  string `json:"company_name"`
}

// ProjectConfig groups services under a project heading on the status page.
type ProjectConfig struct {
	ProjectID         string          `json:"project_id"`
	PublicName        string          `json:"public_name"`
	PublicDescription string          `json:"public_description"`
	Services          []ServiceConfig `json:"services"`
}

// ServiceConfig defines which service to show and how on the status page.
type ServiceConfig struct {
	ServiceID         string `json:"service_id"`
	PublicName        string `json:"public_name"`
	PublicDescription string `json:"public_description"`
	ShowResponseTime  bool   `json:"show_response_time"`
}
