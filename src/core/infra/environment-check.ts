import { EnvironmentCheck } from '../../types';
import * as os from 'os';

export function checkEnvironment(): EnvironmentCheck {
  const platform = process.platform;
  const release = os.release();

  let osVersion: string;
  if (platform === 'win32') {
    osVersion = `Windows ${release}`;
  } else if (platform === 'darwin') {
    osVersion = `macOS ${release}`;
  } else {
    osVersion = `Linux ${release}`;
  }

  const issues: EnvironmentCheck['issues'] = [];

  // Windows特定检查
  if (platform === 'win32') {
    // 检查Windows版本（需要Windows 7+）
    // Windows 7: NT 6.1, Windows 8: NT 6.2, Windows 8.1: NT 6.3, Windows 10: NT 10.0
    const winVersion = parseFloat(release);
    if (winVersion < 6.1) {
      issues.push({
        title: 'Windows版本过低',
        description: '需要Windows 7或更高版本',
        severity: 'critical',
        solution: '请升级Windows系统到Windows 7或更高版本',
        downloadUrl: 'https://www.microsoft.com/windows',
      });
    }
  }

  // macOS特定检查
  if (platform === 'darwin') {
    const macVersion = parseFloat(release);
    if (macVersion < 19.0) {
      // macOS 10.15 Catalina
      issues.push({
        title: 'macOS版本过低',
        description: '需要macOS 10.15 (Catalina)或更高版本',
        severity: 'critical',
        solution: '请升级macOS系统到最新版本',
        downloadUrl: 'https://support.apple.com/macos',
      });
    }
  }

  return {
    osVersion,
    isReady: issues.filter((i) => i.severity === 'critical').length === 0,
    issues,
  };
}
