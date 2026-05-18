declare module 'vue-virtual-scroller' {
  import { DefineComponent } from 'vue';

  export const RecycleScroller: DefineComponent<{
    items: any[];
    itemSize: number;
    keyField?: string;
    minItemSize?: number;
    pageMode?: boolean;
    prerender?: number;
    buffer?: number;
  }>;

  export const DynamicScroller: DefineComponent<{
    items: any[];
    minItemSize: number;
    keyField?: string;
  }>;

  export const DynamicScrollerItem: DefineComponent<{
    item: any;
    active: boolean;
    sizeDependencies?: any[];
  }>;
}
