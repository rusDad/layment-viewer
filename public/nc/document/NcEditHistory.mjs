export const NC_EDIT_HISTORY_LIMIT = 100;

export class NcEditHistory {
  constructor({ limit = NC_EDIT_HISTORY_LIMIT } = {}) {
    this.limit = Math.max(1, Number.isInteger(limit) ? limit : NC_EDIT_HISTORY_LIMIT);
    this.past = [];
    this.future = [];
    this.nextId = 1;
  }

  clear() { this.past = []; this.future = []; }
  canUndo() { return this.past.length > 0; }
  canRedo() { return this.future.length > 0; }
  getState() { return Object.freeze({ pastCount: this.past.length, futureCount: this.future.length, limit: this.limit }); }

  push(transaction) {
    if (!transaction?.beforeDocument || !transaction?.afterDocument) return null;
    const tx = Object.freeze({ id: transaction.id ?? `nc-edit-${this.nextId++}`, timestamp: transaction.timestamp ?? Date.now(), ...transaction });
    this.past.push(tx);
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
    this.future = [];
    return tx;
  }

  peekUndo() { return this.past.at(-1) ?? null; }
  peekRedo() { return this.future.at(-1) ?? null; }
  moveUndo() {
    const tx = this.past.pop();
    if (!tx) return { ok: false, error: historyError('history-empty', 'There is no edit to undo.') };
    this.future.push(tx);
    return { ok: true, transaction: tx };
  }
  moveRedo() {
    const tx = this.future.pop();
    if (!tx) return { ok: false, error: historyError('redo-empty', 'There is no edit to redo.') };
    this.past.push(tx);
    return { ok: true, transaction: tx };
  }
}

export function historyError(code, message, extra = {}) { return Object.freeze({ code, message, operationKind: 'history', ...extra }); }
