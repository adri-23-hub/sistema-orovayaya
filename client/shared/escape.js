/**
 * escape.js — Helpers de escape HTML compartidos (POS + Admin).
 * Usar SIEMPRE para interpolar datos dinámicos en innerHTML.
 */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escAttr(s) { return esc(s).replace(/`/g, '&#96;'); }

window.esc = esc;
window.escAttr = escAttr;
