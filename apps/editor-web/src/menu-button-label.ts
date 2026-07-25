/** Update a menu button label without wiping its leading icon. */
export function setMenuButtonLabel(button: HTMLElement, label: string): void {
  const labelEl = button.querySelector(".menu-item-label");
  if (labelEl) {
    labelEl.textContent = label;
    return;
  }
  button.textContent = label;
}
