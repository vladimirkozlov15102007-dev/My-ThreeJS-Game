// Keyboard / mouse input with pointer-lock awareness.
export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.justPressed = new Set();
    this.mouseDown = new Set();
    this.mouseJustPressed = new Set();
    this.mouseJustReleased = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.pointerLocked = false;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.justPressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDown.add(e.button);
      this.mouseJustPressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseDown.delete(e.button);
      this.mouseJustReleased.add(e.button);
    });
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    window.addEventListener('wheel', (e) => { this.wheel += e.deltaY; });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
    });
  }

  requestLock() { this.dom.requestPointerLock?.(); }
  isDown(code) { return this.keys.has(code); }
  wasPressed(code) { return this.justPressed.has(code); }
  isMouseDown(btn) { return this.mouseDown.has(btn); }
  wasMousePressed(btn) { return this.mouseJustPressed.has(btn); }
  wasMouseReleased(btn) { return this.mouseJustReleased.has(btn); }

  endFrame() {
    this.justPressed.clear();
    this.mouseJustPressed.clear();
    this.mouseJustReleased.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
