<script setup lang="ts">
  defineEmits<{
    close: [];
  }>();
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-container">
      <div class="modal-header">
        <h3>关于 内容审查官</h3>
        <button class="close-btn" @click="$emit('close')">×</button>
      </div>

      <div class="modal-body">
        <div class="about-content">
          <img src="../assets/icons/icon.svg" alt="ContentInspector Logo" class="app-icon" />
          <h2 class="app-name">内容审查官</h2>
          <p class="app-subtitle">ContentInspector v1.0.15</p>

          <div class="app-description">
            <h4>软件介绍</h4>
            <p>
              内容审查官（ContentInspector）是一款强大的本地内容搜索与审查工具，专注于文件内容的智能搜索与安全审查。
            </p>
            <p>
              它不仅能帮助您快速检索文件中的关键信息，还能智能识别身份证号、手机号、邮箱、银行卡号等敏感数据，
              并提供可视化的高亮预览和报告导出功能，是您管理文件内容安全的得力助手。
            </p>
            <p>
              采用 Worker Threads 多线程技术和真正的流式处理架构，将 CPU
              密集型的文件解析任务放到后台线程执行。 文本文件使用滑动窗口重叠策略（5MB 分块 + 200
              字符重叠），确保跨边界敏感词不漏检；
              文档文件（PDF/Word/Excel）先提取文本再流式发送，大文件预览首屏加载 &lt; 500ms。
            </p>
            <p>
              智能并发控制根据 CPU 核心数和可用内存动态调整，在性能和稳定性之间取得最佳平衡。 PDF
              解析使用 Mozilla 官方 pdf.js 引擎，逐页处理并即时释放内存，支持纯图检测。 支持 Windows
              7/10/11、macOS 和 Linux 平台。
            </p>
            <p class="win7-compatible">
              <svg class="check-icon"><use href="#icon-checked" /></svg>
              完全兼容 Windows 7 SP1+
            </p>
          </div>

          <div class="author-info">
            <h4>作者信息</h4>
            <p><strong>开发者：</strong>易峰</p>
            <p><strong>联系邮箱：</strong><a href="mailto:yifengjob@qq.com">yifengjob@qq.com</a></p>
          </div>

          <div class="features">
            <h4>主要功能</h4>
            <ul>
              <li>
                <svg class="check-icon"><use href="#icon-checked" /></svg
                >智能内容搜索（支持自定义表达式）
              </li>
              <li>
                <svg class="check-icon"><use href="#icon-checked" /></svg
                >敏感信息自动检测（身份证、手机、邮箱等）
              </li>
              <li>
                <svg class="check-icon"><use href="#icon-checked" /></svg>实时扫描进度显示
              </li>
              <li>
                <svg class="check-icon"><use href="#icon-checked" /></svg>敏感内容高亮预览（Worker
                线程处理，界面流畅）
              </li>
              <li>
                <svg class="check-icon"><use href="#icon-checked" /></svg>支持 PDF、Excel、Word、PPT
                等文档解析
              </li>
              <li>
                <svg class="check-icon"><use href="#icon-checked" /></svg>扫描结果导出为
                XLSX/CSV/JSON
              </li>
              <li>
                <svg class="check-icon"><use href="#icon-checked" /></svg>跨平台支持（Windows
                7/10/11、macOS、Linux）
              </li>
              <li>
                <svg class="check-icon"><use href="#icon-checked" /></svg>便携免安装设计
              </li>
              <li>
                <svg class="check-icon"><use href="#icon-checked" /></svg
                >智能并发控制（根据硬件配置自动调整）
              </li>
              <li>
                <svg class="check-icon"><use href="#icon-checked" /></svg>多线程架构（CPU
                密集型任务隔离）
              </li>
              <li>
                <svg class="check-icon"><use href="#icon-checked" /></svg
                >真正流式处理（滑动窗口重叠策略，无漏检）
              </li>
              <li>
                <svg class="check-icon"><use href="#icon-checked" /></svg>PDF 逐页解析（Mozilla
                pdf.js，内存优化）
              </li>
            </ul>
          </div>

          <div class="copyright">
            <p>© 2026 YiFeng. All rights reserved.</p>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-primary" @click="$emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-container {
    background-color: var(--modal-bg);
    color: var(--text-color);
    border-radius: 8px;
    width: min(90%, 700px);
    max-height: 85vh;
    min-width: 400px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-color);
  }

  .modal-header h3 {
    font-size: 16px;
    font-weight: 600;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 28px;
    cursor: pointer;
    color: #999;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--text-color);
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
  }

  .about-content {
    text-align: center;
  }

  .app-icon {
    width: 96px;
    height: 96px;
    margin-bottom: 16px;
    object-fit: contain;
  }

  .app-name {
    font-size: 28px;
    font-weight: 700;
    color: var(--primary-color);
    margin: 0 0 8px 0;
  }

  .app-subtitle {
    font-size: 16px;
    color: var(--text-secondary);
    margin: 0 0 24px 0;
    font-weight: 500;
  }

  .app-description,
  .author-info,
  .features {
    text-align: left;
    margin-bottom: 24px;
    padding: 16px;
    background-color: var(--bg-hover);
    border-radius: 6px;
  }

  .app-description h4,
  .author-info h4,
  .features h4 {
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 12px 0;
    color: var(--text-color);
  }

  .app-description p {
    font-size: 14px;
    line-height: 1.8;
    color: var(--text-secondary);
    margin: 8px 0;
  }

  .author-info p {
    font-size: 14px;
    margin: 8px 0;
    color: var(--text-secondary);
  }

  .author-info a {
    color: var(--primary-color);
    text-decoration: none;
  }

  .author-info a:hover {
    text-decoration: underline;
  }

  .features ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .features li {
    font-size: 14px;
    color: var(--text-secondary);
    padding: 6px 0;
    line-height: 1.6;
  }

  .check-icon {
    width: 24px;
    height: 24px;
    vertical-align: middle;
    margin-right: 4px;
  }

  .win7-compatible {
    color: var(--success-color);
    font-weight: 500;
  }

  .copyright {
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--border-color);
  }

  .copyright p {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0;
  }

  .modal-footer {
    display: flex;
    gap: 10px;
    justify-content: center;
    padding: 12px 20px;
    border-top: 1px solid var(--border-color);
  }

  .btn {
    padding: 8px 24px;
    border: 1px solid var(--border-color);
    background-color: var(--bg-color);
    color: var(--text-color);
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }

  .btn:hover {
    background-color: var(--bg-hover);
  }

  .btn-primary {
    background-color: var(--primary-color);
    color: white;
    border-color: var(--primary-color);
  }

  .btn-primary:hover {
    background-color: #40a9ff;
  }
</style>
