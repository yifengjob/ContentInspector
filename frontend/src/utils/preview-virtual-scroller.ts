/**
 * 【方案 D3】预览虚拟滚动管理器
 *
 * 负责管理大文件预览的虚拟滚动，包括：
 * - 行索引构建（字符偏移 → 行号映射）
 * - 可见区域计算
 * - 高亮坐标转换（全局 → 行内）
 */

export interface LineHighlight {
  lineIndex: number; // 行号
  localStart: number; // 行内起始位置
  localEnd: number; // 行内结束位置
  typeId: string;
  typeName: string;
}

export interface GlobalHighlight {
  start: number; // 全局字符偏移
  end: number;
  typeId: string;
  typeName: string;
}

interface VirtualScrollerState {
  allLines: string[]; // 所有行（分割后的文本）
  totalLines: number; // 总行数
  lineHeight: number; // 每行高度（像素）
  viewportHeight: number; // 视口高度
  scrollTop: number; // 滚动位置
  visibleStartLine: number; // 可见起始行
  visibleEndLine: number; // 可见结束行
  bufferLines: number; // 缓冲行数（上下各多渲染几行）

  // 行索引缓存
  lineStartPositions: number[]; // 每行的起始字符位置 [0, 45, 98, ...]
}

export class PreviewVirtualScroller {
  private state: VirtualScrollerState;

  constructor(lineHeight: number = 20, bufferLines: number = 10) {
    this.state = {
      allLines: [],
      totalLines: 0,
      lineHeight,
      viewportHeight: 0,
      scrollTop: 0,
      visibleStartLine: 0,
      visibleEndLine: 0,
      bufferLines,
      lineStartPositions: [],
    };
  }

  /**
   * 初始化数据（增量更新）
   */
  updateData(lines: string[]) {
    if (!lines || !Array.isArray(lines) || lines.length === 0) return;

    // 【安全检查】防止异常大的数据块导致内存崩溃
    if (lines.length > 50000) {
      console.warn('[Scroller] 接收到超大数据块，行数:', lines.length);
    }

    if (this.state.allLines.length === 0) {
      // 首次加载：直接赋值，但确保是纯数组
      this.state.allLines = Array.from(lines);
      this.state.totalLines = this.state.allLines.length;
      this.buildLineIndex();
    } else {
      // 增量追加：使用 for 循环逐项 push，彻底避开 spread 操作符的长度限制
      const currentLength = this.state.allLines.length;

      // 【关键修复】循环追加，虽然比 spread 慢一点，但绝对安全
      for (let i = 0; i < lines.length; i++) {
        // 确保存入的是字符串，防止非法对象导致后续渲染报错
        if (typeof lines[i] === 'string') {
          this.state.allLines.push(lines[i]);
        }
      }

      this.state.totalLines = this.state.allLines.length;

      // 增量构建行索引
      this.buildLineIndexIncremental(currentLength);
    }
  }

  /**
   * 构建完整的行索引
   */
  private buildLineIndex() {
    this.state.lineStartPositions = [0];

    let position = 0;
    for (let i = 0; i < this.state.allLines.length; i++) {
      position += this.state.allLines[i].length + 1; // +1 是换行符
      this.state.lineStartPositions.push(position);
    }
  }

  /**
   * 增量构建行索引（从指定行开始）
   */
  private buildLineIndexIncremental(fromLine: number) {
    // 如果已有索引不完整，重新构建
    if (this.state.lineStartPositions.length <= fromLine) {
      this.buildLineIndex();
      return;
    }

    // 从指定位置继续构建
    let position = this.state.lineStartPositions[fromLine];
    for (let i = fromLine; i < this.state.allLines.length; i++) {
      position += this.state.allLines[i].length + 1;
      this.state.lineStartPositions.push(position);
    }
  }

  /**
   * 计算可见区域
   */
  calculateVisibleRange(
    scrollTop: number,
    viewportHeight: number
  ): { startLine: number; endLine: number } {
    this.state.scrollTop = scrollTop;
    this.state.viewportHeight = viewportHeight;

    const startLine = Math.floor(scrollTop / this.state.lineHeight);
    const visibleLineCount = Math.ceil(viewportHeight / this.state.lineHeight);
    const endLine = Math.min(startLine + visibleLineCount, this.state.totalLines - 1);

    // 添加缓冲区域
    const bufferedStart = Math.max(0, startLine - this.state.bufferLines);
    const bufferedEnd = Math.min(this.state.totalLines - 1, endLine + this.state.bufferLines);

    this.state.visibleStartLine = bufferedStart;
    this.state.visibleEndLine = bufferedEnd;

    return {
      startLine: bufferedStart,
      endLine: bufferedEnd,
    };
  }

  /**
   * 获取可见行
   */
  getVisibleLines(): { lines: string[]; startIndex: number } {
    const { startLine, endLine } = {
      startLine: this.state.visibleStartLine,
      endLine: this.state.visibleEndLine,
    };

    const lines = this.state.allLines.slice(startLine, endLine + 1);
    return {
      lines,
      startIndex: startLine,
    };
  }

  /**
   * 获取总高度
   */
  getTotalHeight(): number {
    return this.state.totalLines * this.state.lineHeight;
  }

  /**
   * 获取偏移量（用于 transform）
   */
  getOffsetTop(): number {
    return this.state.visibleStartLine * this.state.lineHeight;
  }

  /**
   * 根据字符偏移量查找行号（二分查找）
   */
  findLineNumberByOffset(offset: number): number {
    const positions = this.state.lineStartPositions;
    let left = 0;
    let right = positions.length - 2;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);

      if (offset >= positions[mid] && offset < positions[mid + 1]) {
        return mid;
      } else if (offset < positions[mid]) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }

    return positions.length - 2;
  }

  /**
   * 转换全局高亮为行内高亮
   */
  convertHighlights(globalHighlights: GlobalHighlight[]): Map<number, LineHighlight[]> {
    const lineHighlightsMap = new Map<number, LineHighlight[]>();

    for (const highlight of globalHighlights) {
      const startLine = this.findLineNumberByOffset(highlight.start);
      const endLine = this.findLineNumberByOffset(highlight.end);

      if (startLine === endLine) {
        // 情况 1：高亮在同一行内
        const localStart = highlight.start - this.state.lineStartPositions[startLine];
        const localEnd = highlight.end - this.state.lineStartPositions[startLine];

        if (!lineHighlightsMap.has(startLine)) {
          lineHighlightsMap.set(startLine, []);
        }
        const startLineHighlights = lineHighlightsMap.get(startLine);
        if (startLineHighlights) {
          startLineHighlights.push({
            lineIndex: startLine,
            localStart,
            localEnd,
            typeId: highlight.typeId,
            typeName: highlight.typeName,
          });
        }
      } else {
        // 情况 2：高亮跨越多行，需要拆分

        // 第一行：从起始位置到行尾
        const firstLocalEnd =
          this.state.lineStartPositions[startLine + 1] -
          1 -
          this.state.lineStartPositions[startLine];
        if (!lineHighlightsMap.has(startLine)) {
          lineHighlightsMap.set(startLine, []);
        }
        const firstLineHighlights = lineHighlightsMap.get(startLine);
        if (firstLineHighlights) {
          firstLineHighlights.push({
            lineIndex: startLine,
            localStart: highlight.start - this.state.lineStartPositions[startLine],
            localEnd: firstLocalEnd,
            typeId: highlight.typeId,
            typeName: highlight.typeName,
          });
        }

        // 中间行：整行高亮
        for (let line = startLine + 1; line < endLine; line++) {
          if (!lineHighlightsMap.has(line)) {
            lineHighlightsMap.set(line, []);
          }
          const midLineHighlights = lineHighlightsMap.get(line);
          if (midLineHighlights) {
            midLineHighlights.push({
              lineIndex: line,
              localStart: 0,
              localEnd:
                this.state.lineStartPositions[line + 1] - this.state.lineStartPositions[line] - 1,
              typeId: highlight.typeId,
              typeName: highlight.typeName,
            });
          }
        }

        // 最后一行：从行首到结束位置
        const lastLocalEnd = highlight.end - this.state.lineStartPositions[endLine];
        if (!lineHighlightsMap.has(endLine)) {
          lineHighlightsMap.set(endLine, []);
        }
        const endLineHighlights = lineHighlightsMap.get(endLine);
        if (endLineHighlights) {
          endLineHighlights.push({
            lineIndex: endLine,
            localStart: 0,
            localEnd: lastLocalEnd,
            typeId: highlight.typeId,
            typeName: highlight.typeName,
          });
        }
      }
    }

    return lineHighlightsMap;
  }

  /**
   * 获取指定行范围的高亮
   */
  getHighlightsForRange(
    lineHighlightsMap: Map<number, LineHighlight[]>,
    startLine: number,
    endLine: number
  ): Map<number, LineHighlight[]> {
    const result = new Map<number, LineHighlight[]>();

    for (let line = startLine; line <= endLine; line++) {
      const highlights = lineHighlightsMap.get(line);
      if (highlights && highlights.length > 0) {
        result.set(line, highlights);
      }
    }

    return result;
  }

  /**
   * 获取指定行的字符偏移量（O(1) 复杂度）
   */
  getLineOffset(lineNumber: number): number {
    if (lineNumber < this.state.lineStartPositions.length) {
      return this.state.lineStartPositions[lineNumber];
    }
    return 0;
  }

  /**
   * 重置状态
   */
  reset() {
    this.state.allLines = [];
    this.state.totalLines = 0;
    this.state.lineStartPositions = [];
    this.state.visibleStartLine = 0;
    this.state.visibleEndLine = 0;
    this.state.scrollTop = 0;
  }
}
