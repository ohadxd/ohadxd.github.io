const copyButtons = Array.from(document.querySelectorAll("[data-copy-target]"));
const lightbox = document.getElementById("gifLightbox");
const lightboxImg = document.getElementById("lightboxImg");
const closeLightboxButton = document.getElementById("closeLightbox");
const zoomButtons = Array.from(document.querySelectorAll(".zoomable-gif .img-btn"));

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

function openLightbox(src, alt) {
  if (!lightbox || !lightboxImg) {
    return;
  }

  lightboxImg.src = src;
  lightboxImg.alt = alt || "תמונה מוגדלת";
  lightbox.classList.add("is-open");
  lightbox.setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");
}

function closeLightbox() {
  if (!lightbox || !lightboxImg) {
    return;
  }

  lightbox.classList.remove("is-open");
  lightbox.setAttribute("aria-hidden", "true");
  lightboxImg.src = "";
  document.body.classList.remove("no-scroll");
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

zoomButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const image = button.querySelector("img");

    if (!image || !image.src) {
      return;
    }

    openLightbox(image.src, image.alt);
  });
});

if (closeLightboxButton) {
  closeLightboxButton.addEventListener("click", closeLightbox);
}

if (lightbox) {
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) {
      closeLightbox();
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && lightbox && lightbox.classList.contains("is-open")) {
    closeLightbox();
  }
});
