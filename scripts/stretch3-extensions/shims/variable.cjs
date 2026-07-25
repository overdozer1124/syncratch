/**
 * Minimal Scratch Variable class for NumberBank (avoids bundling engine/*).
 * Mirrors vendor/scratch-editor/packages/scratch-vm/src/engine/variable.js API
 * used by the extension.
 */
function uid() {
  return `var-${Math.random().toString(36).slice(2, 10)}`;
}

class Variable {
  constructor(id, name, type, isCloud) {
    this.id = id || uid();
    this.name = name;
    this.type = type;
    this.isCloud = isCloud;
    switch (this.type) {
      case Variable.SCALAR_TYPE:
        this.value = 0;
        break;
      case Variable.LIST_TYPE:
        this.value = [];
        break;
      case Variable.BROADCAST_MESSAGE_TYPE:
        this.value = this.name;
        break;
      default:
        throw new Error(`Invalid variable type: ${this.type}`);
    }
  }
}

Variable.SCALAR_TYPE = "";
Variable.LIST_TYPE = "list";
Variable.BROADCAST_MESSAGE_TYPE = "broadcast_msg";

module.exports = Variable;
