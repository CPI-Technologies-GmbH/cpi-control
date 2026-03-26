//go:build !windows

package updater

import "syscall"

func syscallExec(binary string, argv []string, env []string) error {
	return syscall.Exec(binary, argv, env)
}
