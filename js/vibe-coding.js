const copyButtons = Array.from(document.querySelectorAll("[data-copy-target]"));

async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const helper = document.createElement("textarea");
  helper.value = text;
  helper.setAttribute("readonly", "");
  helper.style.position = "absolute";
  helper.style.left = "-9999px";
  document.body.appendChild(helper);
  helper.select();
  document.execCommand("copy");
  document.body.removeChild(helper);
}

function setCopiedState(button, originalText) {
  button.textContent = "הועתק";
  button.classList.add("is-copied");

  window.setTimeout(() => {
    button.textContent = originalText;
    button.classList.remove("is-copied");
  }, 1800);
}

copyButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const targetId = button.getAttribute("data-copy-target");
    const source = targetId ? document.getElementById(targetId) : null;

    if (!source) {
      return;
    }

    const originalText = button.textContent;
    const copyValue = "value" in source ? source.value : source.textContent || "";

    try {
      await copyText(copyValue.trimEnd());
      setCopiedState(button, originalText);
    } catch (error) {
      button.textContent = "לא הצליח";
      window.setTimeout(() => {
        button.textContent = originalText;
      }, 1800);
      console.error(error);
    }
  });
});
