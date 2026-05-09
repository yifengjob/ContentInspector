import { EventEmitter } from 'events';

export class ScanState extends EventEmitter {
  public isScanning: boolean = false;
  public cancelFlag: boolean = false;
  public logs: string[] = [];
  
  constructor() {
    super();
  }
  
  reset() {
    this.isScanning = false;
    this.cancelFlag = false;
    this.logs = [];
  }
}
