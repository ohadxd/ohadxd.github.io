(function () {
  const lightbox = document.getElementById("gifLightbox");
  const lightboxImg = document.getElementById("lightboxImg");
  const closeBtn = document.getElementById("closeLightbox");
  const gifButtons = document.querySelectorAll(".zoomable-gif .img-btn");
  const stepImages = document.querySelectorAll(".step-static-image img");
  const slots = document.querySelectorAll(".slot[data-step]");
  const doneButtons = document.querySelectorAll(".done-toggle");
  const doneCountEl = document.getElementById("doneCount");
  const totalCountEl = document.getElementById("totalCount");
  const progressFill = document.getElementById("progressFill");
  const progressKey = "lesson2-progress-v1";

  const storedSteps = JSON.parse(localStorage.getItem(progressKey) || "[]");
  const doneSteps = new Set(storedSteps);

  function updateProgressUI() {
    let doneCount = 0;
    if (totalCountEl) {
      totalCountEl.textContent = String(slots.length);
    }

    slots.forEach(function (slot) {
      const step = slot.getAttribute("data-step");
      const btn = slot.querySelector(".done-toggle");
      const isDone = doneSteps.has(step);
      slot.classList.toggle("is-done", isDone);
      if (btn) {
        btn.setAttribute("aria-pressed", isDone ? "true" : "false");
      }
      if (isDone) {
        doneCount += 1;
      }
    });

    if (doneCountEl) {
      doneCountEl.textContent = String(doneCount);
    }
    if (progressFill) {
      progressFill.style.width = (doneCount / Math.max(slots.length, 1)) * 100 + "%";
    }
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

  gifButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      const img = btn.querySelector("img");
      if (img && img.src) {
        openLightbox(img.src, img.alt);
      }
    });
  });

  stepImages.forEach(function (img) {
    img.addEventListener("click", function () {
      if (img.src) {
        openLightbox(img.src, img.alt);
      }
    });
  });

  doneButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      const slot = btn.closest(".slot");
      if (!slot) {
        return;
      }
      const step = slot.getAttribute("data-step");
      if (!step) {
        return;
      }
      if (doneSteps.has(step)) {
        doneSteps.delete(step);
      } else {
        doneSteps.add(step);
      }
      localStorage.setItem(progressKey, JSON.stringify(Array.from(doneSteps)));
      updateProgressUI();
    });
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", closeLightbox);
  }

  if (lightbox) {
    lightbox.addEventListener("click", function (event) {
      if (event.target === lightbox) {
        closeLightbox();
      }
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && lightbox && lightbox.classList.contains("is-open")) {
      closeLightbox();
    }
  });

  updateProgressUI();
})();
