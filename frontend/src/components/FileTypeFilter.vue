<script setup lang="ts">
  import { ref } from 'vue';
  import { useAppStore } from '@/stores/app';
  import { storeToRefs } from 'pinia';

  const appStore = useAppStore();
  const { config } = storeToRefs(appStore);

  const collapsed = ref(false);

  // 文件类型分组
  const fileGroups: Record<string, string[]> = {
    文本文件: ['txt', 'log', 'md', 'ini', 'conf', 'cfg', 'env'],
    代码文件: [
      'js',
      'ts',
      'py',
      'java',
      'c',
      'cpp',
      'go',
      'rs',
      'php',
      'rb',
      'swift',
      'html',
      'htm',
      'sh',
      'cmd',
      'bat',
    ],
    数据文件: ['csv', 'json', 'xml', 'yaml', 'yml', 'properties', 'toml'],
    PDF文档: ['pdf'],
    办公文档: ['docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'wps', 'et', 'dps'],
    // '压缩文件': ['zip', 'rar', '7z', 'tar', 'gz'],
  };

  const isGroupAllChecked = (groupName: string): boolean => {
    const extensions = fileGroups[groupName];
    return extensions.every((ext) => config.value.selectedExtensions.includes(ext));
  };

  const handleGroupCheck = (groupName: string, event: Event) => {
    const checked = (event.target as HTMLInputElement).checked;
    const extensions = fileGroups[groupName];

    if (checked) {
      extensions.forEach((ext) => {
        if (!config.value.selectedExtensions.includes(ext)) {
          config.value.selectedExtensions.push(ext);
        }
      });
    } else {
      config.value.selectedExtensions = config.value.selectedExtensions.filter(
        (ext) => !extensions.includes(ext)
      );
    }
  };

  const handleExtensionCheck = (ext: string, event: Event) => {
    const checked = (event.target as HTMLInputElement).checked;

    if (checked) {
      if (!config.value.selectedExtensions.includes(ext)) {
        config.value.selectedExtensions.push(ext);
      }
    } else {
      config.value.selectedExtensions = config.value.selectedExtensions.filter((e) => e !== ext);
    }
  };

  const handleAllFilesCheck = (event: Event) => {
    const checked = (event.target as HTMLInputElement).checked;

    if (checked) {
      // 选中“所有文件类型”，清空其他选项，只保留 "*"
      config.value.selectedExtensions = ['*'];
    } else {
      // 取消选中，移除 "*"
      config.value.selectedExtensions = config.value.selectedExtensions.filter((e) => e !== '*');
    }
  };
</script>

<template>
  <div class="file-type-filter">
    <div class="filter-header" @click="collapsed = !collapsed">
      <h3>文件类型</h3>
      <svg v-if="collapsed" class="collapse-icon"><use href="#icon-arrow-right" /></svg>
      <svg v-else class="collapse-icon"><use href="#icon-arrow-down" /></svg>
    </div>

    <div v-show="!collapsed" class="filter-content">
      <!-- 所有文件类型选项 -->
      <div class="file-group all-files-group">
        <div class="group-header">
          <label class="group-label all-files-label">
            <input
              type="checkbox"
              :checked="config.selectedExtensions.includes('*')"
              @change="handleAllFilesCheck($event)"
            />
            <strong>所有支持的文件类型</strong>
          </label>
        </div>
      </div>

      <!-- 其他文件类型分组 -->
      <div
        v-for="(group, groupName) in fileGroups"
        :key="groupName"
        class="file-group"
        :class="{ disabled: config.selectedExtensions.includes('*') }"
      >
        <div class="group-header">
          <label class="group-label">
            <input
              type="checkbox"
              :checked="isGroupAllChecked(groupName)"
              :disabled="config.selectedExtensions.includes('*')"
              @change="handleGroupCheck(groupName, $event)"
            />
            {{ groupName }}
            <span v-if="groupName === '办公文档'" class="format-hint"
              >（.doc/.ppt 为简化解析）</span
            >
            <span v-if="groupName === '压缩文件'" class="format-hint">（仅索引，不扫描内容）</span>
          </label>
        </div>
        <div class="group-extensions">
          <label
            v-for="ext in group"
            :key="ext"
            class="extension-item"
            :class="{ disabled: config.selectedExtensions.includes('*') }"
          >
            <input
              type="checkbox"
              :checked="config.selectedExtensions.includes(ext)"
              :disabled="config.selectedExtensions.includes('*')"
              @change="handleExtensionCheck(ext, $event)"
            />
            .{{ ext }}
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .file-type-filter {
    border-top: 1px solid var(--border-color);
  }

  .filter-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    background-color: var(--toolbar-bg);
    cursor: pointer;
    user-select: none;
  }

  .filter-header h3 {
    font-size: 14px;
    font-weight: 600;
  }

  .collapse-icon {
    width: 12px;
    height: 12px;
    color: var(--text-secondary);
  }

  .filter-content {
    padding: 12px;
    max-height: 300px;
    overflow-y: auto;
  }

  .file-group {
    margin-bottom: 12px;
  }

  .group-header {
    margin-bottom: 6px;
  }

  .group-label {
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .format-hint {
    font-size: 11px;
    color: var(--text-secondary);
    font-weight: normal;
    margin-left: 4px;
  }

  .group-extensions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding-left: 20px;
  }

  .extension-item {
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .extension-item input[type='checkbox'] {
    cursor: pointer;
  }

  .all-files-group {
    padding: 8px;
    background-color: var(--bg-selected);
    border-radius: 4px;
    margin-bottom: 16px;
  }

  .all-files-label {
    font-size: 14px;
  }

  .file-group.disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .extension-item.disabled {
    opacity: 0.5;
  }
</style>
