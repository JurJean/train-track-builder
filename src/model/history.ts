/**
 * A generic undo/redo stack with unlimited depth.
 *
 * `present` is the value currently in effect. `push` records it in the past
 * before moving on, which drops any redo branch: after an undo, the next push
 * starts a fresh future.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private current: T;

  constructor(initial: T) {
    this.current = initial;
  }

  get present(): T {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  push(next: T): void {
    this.past.push(this.current);
    this.current = next;
    this.future.length = 0;
  }

  undo(): T {
    if (this.past.length === 0) return this.current;
    this.future.unshift(this.current);
    this.current = this.past.pop() as T;
    return this.current;
  }

  redo(): T {
    if (this.future.length === 0) return this.current;
    this.past.push(this.current);
    this.current = this.future.shift() as T;
    return this.current;
  }

  reset(value: T): void {
    this.past.length = 0;
    this.future.length = 0;
    this.current = value;
  }
}
