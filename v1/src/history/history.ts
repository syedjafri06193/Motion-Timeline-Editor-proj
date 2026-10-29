/**
 * Undo/redo over immutable states, with coalescing (§10.4): a drag is one
 * command however many mouse-moves it has, and a drag that changes nothing
 * leaves no undo step.
 */
export interface Command<S> { label: string; before: S; after: S }

export class History<S> {
  private undoStack: Command<S>[] = [];
  private redoStack: Command<S>[] = [];
  private open: Command<S> | null = null;
  constructor(private state: S, private equal: (a: S, b: S) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b), private limit = 500) {}

  get current(): S { return this.open ? this.open.after : this.state; }
  get canUndo(): boolean { return this.undoStack.length > 0 && !this.open; }
  get canRedo(): boolean { return this.redoStack.length > 0 && !this.open; }
  get size(): number { return this.undoStack.length; }

  /** One-shot change. */
  apply(label: string, next: S): void {
    this.begin(label);
    this.update(next);
    this.commit();
  }

  /** Start a coalesced interaction (drag start). */
  begin(label: string): void {
    if (this.open) this.commit();
    this.open = { label, before: this.state, after: this.state };
  }

  /** Replace the open command's result (every mouse-move). */
  update(next: S): void {
    if (!this.open) throw new Error("update() outside begin()/commit()");
    this.open.after = next;
  }

  /** End the interaction (drag end). No-op drags are discarded. */
  commit(): void {
    const c = this.open;
    this.open = null;
    if (!c || this.equal(c.before, c.after)) return;
    this.state = c.after;
    this.undoStack.push(c);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  cancel(): void { this.open = null; }

  undo(): S {
    const c = this.undoStack.pop();
    if (c) { this.redoStack.push(c); this.state = c.before; }
    return this.state;
  }

  redo(): S {
    const c = this.redoStack.pop();
    if (c) { this.undoStack.push(c); this.state = c.after; }
    return this.state;
  }

  labels(): string[] { return this.undoStack.map((c) => c.label); }
}
