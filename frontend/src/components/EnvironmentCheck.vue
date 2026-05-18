<script setup lang="ts">
  import { onMounted, ref } from 'vue';
  import { checkSystemEnvironment } from '@/utils/electron-api';

  interface EnvironmentIssue {
    severity: 'Critical' | 'Warning' | 'Info';
    title: string;
    description: string;
    solution: string;
    download_url?: string;
  }

  interface EnvironmentCheck {
    os: string;
    os_version: string;
    issues: EnvironmentIssue[];
    is_ready: boolean;
  }

  const showCheck = ref(true);
  const checking = ref(true);
  const environmentInfo = ref<EnvironmentCheck | null>(null);

  onMounted(async () => {
    await performCheck();
  });

  const performCheck = async () => {
    try {
      checking.value = true;
      const result = await checkSystemEnvironment();
      environmentInfo.value = {
        os: result.osVersion || 'unknown',
        os_version: result.osVersion || '未知',
        issues: (result.issues || []).map((issue: any) => ({
          severity:
            issue.severity === 'critical'
              ? 'Critical'
              : issue.severity === 'warning'
                ? 'Warning'
                : 'Info',
          title: issue.title,
          description: issue.description,
          solution: issue.solution,
          download_url: issue.downloadUrl,
        })),
        is_ready: result.isReady,
      };
    } catch (error) {
      console.error('环境检查失败:', error);
      environmentInfo.value = {
        os: 'unknown',
        os_version: '未知',
        issues: [
          {
            severity: 'Critical',
            title: '环境检查失败',
            description: '无法检测系统环境',
            solution: '请重试或联系技术支持',
          },
        ],
        is_ready: false,
      };
    } finally {
      checking.value = false;
    }
  };

  const closeCheck = () => {
    showCheck.value = false;
  };

  const exitApp = () => {
    // Electron中关闭窗口
    window.close();
  };
</script>

<template>
  <div v-if="showCheck" class="environment-check">
    <div class="check-overlay">
      <div class="check-container">
        <div class="check-header">
          <h2>
            <svg class="title-icon">
              <use href="#icon-search" />
            </svg>
            系统环境检查
          </h2>
        </div>

        <div class="check-body">
          <!-- 加载中 -->
          <div v-if="checking" class="checking-state">
            <div class="spinner"></div>
            <p>正在检查系统环境...</p>
          </div>

          <!-- 检查结果 -->
          <div v-else class="result-state">
            <!-- 系统信息 -->
            <div class="system-info">
              <p><strong>操作系统：</strong>{{ environmentInfo?.os_version || '检测中...' }}</p>
            </div>

            <!-- 通过 -->
            <div
              v-if="environmentInfo?.is_ready && environmentInfo.issues.length === 0"
              class="success-message"
            >
              <svg class="success-icon">
                <use href="#icon-success" />
              </svg>
              <h3>环境检查通过</h3>
              <p>您的系统满足所有要求，可以正常使用本应用。</p>
              <button class="btn btn-primary" @click="closeCheck">开始使用</button>
            </div>

            <!-- 有警告但可以运行 -->
            <div v-else-if="environmentInfo?.is_ready" class="warning-message">
              <svg class="warning-icon">
                <use href="#icon-warning" />
              </svg>
              <h3>环境检查完成（存在建议项）</h3>
              <p>您的系统可以运行本应用，但以下项目可能需要关注：</p>

              <div class="issues-list">
                <div
                  v-for="(issue, index) in environmentInfo.issues"
                  :key="index"
                  class="issue-item warning"
                >
                  <div class="issue-header">
                    <span class="issue-icon">🟡</span>
                    <strong>{{ issue.title }}</strong>
                  </div>
                  <p class="issue-desc">{{ issue.description }}</p>
                  <div class="issue-solution"><strong>建议：</strong>{{ issue.solution }}</div>
                  <a
                    v-if="issue.download_url"
                    :href="issue.download_url"
                    target="_blank"
                    class="download-link"
                  >
                    <svg class="icon-inline">
                      <use href="#icon-download" />
                    </svg>
                    下载链接
                  </a>
                </div>
              </div>

              <button class="btn btn-primary" @click="closeCheck">继续使用</button>
            </div>

            <!-- 严重问题，无法运行 -->
            <div v-else class="error-message">
              <svg class="error-icon-large">
                <use href="#icon-error" />
              </svg>
              <h3>环境检查失败</h3>
              <p>您的系统缺少必要的组件，无法运行本应用：</p>

              <div class="issues-list">
                <div
                  v-for="(issue, index) in environmentInfo?.issues.filter(
                    (i) => i.severity === 'Critical'
                  ) || []"
                  :key="index"
                  class="issue-item critical"
                >
                  <div class="issue-header">
                    <span class="issue-icon">🔴</span>
                    <strong>{{ issue.title }}</strong>
                  </div>
                  <p class="issue-desc">{{ issue.description }}</p>
                  <div class="issue-solution"><strong>解决方案：</strong>{{ issue.solution }}</div>
                  <a
                    v-if="issue.download_url"
                    :href="issue.download_url"
                    target="_blank"
                    class="download-link primary"
                  >
                    <svg class="icon-inline">
                      <use href="#icon-download" />
                    </svg>
                    立即下载
                  </a>
                </div>
              </div>

              <div class="error-actions">
                <p class="hint">安装完成后，请重新启动应用程序。</p>
                <button class="btn" @click="exitApp">退出应用</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .environment-check {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 9999;
  }

  .check-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .check-container {
    background-color: var(--modal-bg);
    color: var(--text-color);
    border-radius: 12px;
    width: 100%;
    max-width: 700px;
    max-height: 90vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }

  .check-header {
    padding: 24px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .check-header h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  /* 【新增】SVG 图标样式 */
  .title-icon {
    width: 28px;
    height: 28px;
    color: white;
    flex-shrink: 0;
  }

  .check-body {
    flex: 1;
    overflow-y: auto;
    padding: 32px;
  }

  .checking-state {
    text-align: center;
    padding: 60px 20px;
  }

  .spinner {
    width: 50px;
    height: 50px;
    border: 4px solid var(--border-color);
    border-top: 4px solid #667eea;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 0 auto 20px;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  .system-info {
    margin-bottom: 24px;
    padding: 16px;
    background-color: var(--bg-hover);
    border-radius: 8px;
    font-size: 14px;
  }

  .success-message,
  .warning-message,
  .error-message {
    text-align: center;
  }

  .success-icon,
  .warning-icon,
  .error-icon-large {
    width: 64px;
    height: 64px;
    margin-bottom: 16px;
  }

  .success-icon {
    color: #52c41a;
  }

  .warning-icon {
    color: #faad14;
  }

  .error-icon-large {
    color: #ff4d4f;
  }

  .success-message h3,
  .warning-message h3,
  .error-message h3 {
    margin: 0 0 12px 0;
    font-size: 20px;
  }

  .success-message h3 {
    color: #52c41a;
  }

  .warning-message h3 {
    color: #faad14;
  }

  .error-message h3 {
    color: #ff4d4f;
  }

  .success-message p,
  .warning-message p,
  .error-message p {
    margin: 0 0 24px 0;
    color: var(--text-secondary);
    line-height: 1.6;
  }

  .issues-list {
    text-align: left;
    margin: 24px 0;
  }

  .issue-item {
    padding: 16px;
    border-radius: 8px;
    margin-bottom: 16px;
    border-left: 4px solid;
  }

  .issue-item.critical {
    background-color: var(--bg-hover);
    border-left-color: #ff4d4f;
  }

  .issue-item.warning {
    background-color: var(--bg-hover);
    border-left-color: #faad14;
  }

  .issue-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .issue-icon {
    font-size: 20px;
  }

  .issue-desc {
    margin: 8px 0;
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 1.5;
  }

  .issue-solution {
    margin-top: 12px;
    padding: 12px;
    background-color: rgba(255, 255, 255, 0.7);
    border-radius: 4px;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-line;
  }

  .download-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 12px;
    padding: 8px 16px;
    background-color: #1890ff;
    color: white;
    text-decoration: none;
    border-radius: 4px;
    font-size: 14px;
    transition: all 0.3s;
  }

  /* 【新增】内联小图标 */
  .icon-inline {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .download-link:hover {
    background-color: #40a9ff;
    transform: translateY(-1px);
  }

  .download-link.primary {
    background-color: #ff4d4f;
  }

  .download-link.primary:hover {
    background-color: #ff7875;
  }

  .error-actions {
    margin-top: 32px;
    padding-top: 24px;
    border-top: 1px solid var(--border-color);
  }

  .hint {
    color: var(--text-secondary);
    font-size: 13px;
    margin-bottom: 16px;
  }

  .btn {
    padding: 10px 24px;
    border: 1px solid var(--border-color);
    background-color: var(--bg-color);
    color: var(--text-color);
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.3s;
  }

  .btn:hover {
    border-color: #40a9ff;
    color: #40a9ff;
  }

  .btn-primary {
    background-color: #1890ff;
    border-color: #1890ff;
    color: white;
  }

  .btn-primary:hover {
    background-color: #40a9ff;
    border-color: #40a9ff;
    color: white;
  }
</style>
