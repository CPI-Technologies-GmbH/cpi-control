//go:build windows

package updater

import (
	"os"
	"os/exec"
)

func syscallExec(binary string, argv []string, env []string) error {
	cmd := exec.Command(binary, argv[1:]...)
	cmd.Env = env
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	if err := cmd.Start(); err != nil {
		return err
	}
	os.Exit(0)
	return nil
}
