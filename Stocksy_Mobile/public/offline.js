// Kept as an external file (not inline) so a strict CSP can be applied later.
document.getElementById("retry").addEventListener("click", function () {
  location.reload();
});
window.addEventListener("online", function () {
  location.reload();
});
