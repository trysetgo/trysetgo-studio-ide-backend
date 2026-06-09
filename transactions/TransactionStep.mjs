export class TransactionStep {
  constructor({ name, execute, compensate }) {
    this.name = name;
    this.execute = execute;
    this.compensate = compensate;
  }
}
