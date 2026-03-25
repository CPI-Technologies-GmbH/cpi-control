package checker

import (
	"log"
	"regexp"
)

// CheckContent checks whether the given body matches the expected regex pattern.
// Returns true if the pattern matches, false otherwise.
// If the pattern is invalid, it returns false and logs the error.
func CheckContent(body string, pattern string) bool {
	if pattern == "" {
		return true
	}

	re, err := regexp.Compile(pattern)
	if err != nil {
		log.Printf("[content] Invalid regex pattern %q: %v", pattern, err)
		return false
	}

	matched := re.MatchString(body)
	if !matched {
		log.Printf("[content] Pattern %q did not match response body (len=%d)", pattern, len(body))
	}

	return matched
}
