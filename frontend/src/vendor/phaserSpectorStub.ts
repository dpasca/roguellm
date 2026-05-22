class Spector {
  readonly onCapture = {
    add: () => undefined
  };

  captureCanvas(): void {
    return;
  }

  captureNextFrame(): void {
    return;
  }

  getFps(): number {
    return 0;
  }

  getResultUI(): { display: () => void } {
    return {
      display: () => undefined
    };
  }
}

export { Spector };
