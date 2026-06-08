const msnhMenuButton = document.querySelector(".msnh-menu-button");
const msnhMenu = document.querySelector(".msnh-menu");
const msnhHeader = document.querySelector("[data-header]");
const msnhMobileCta = document.querySelector(".msnh-mobile-cta");

if (msnhMenuButton && msnhMenu) {
  msnhMenuButton.addEventListener("click", () => {
    const isOpen = msnhMenu.classList.toggle("msnh-open");
    document.body.classList.toggle("msnh-menu-open", isOpen);
    msnhMenuButton.setAttribute("aria-expanded", String(isOpen));
  });

  msnhMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      msnhMenu.classList.remove("msnh-open");
      document.body.classList.remove("msnh-menu-open");
      msnhMenuButton.setAttribute("aria-expanded", "false");
    });
  });
}

const msnhSetHeader = () => {
  if (!msnhHeader) return;
  msnhHeader.classList.toggle("msnh-scrolled", window.scrollY > 12);
  if (msnhMobileCta) {
    msnhMobileCta.classList.toggle("msnh-show", window.scrollY > 520);
  }
};

msnhSetHeader();
window.addEventListener("scroll", msnhSetHeader, { passive: true });

document.querySelectorAll(".msnh-faq-list details").forEach((item) => {
  item.addEventListener("toggle", () => {
    if (!item.open) return;
    document.querySelectorAll(".msnh-faq-list details").forEach((other) => {
      if (other !== item) other.open = false;
    });
  });
});

const msnhRevealItems = document.querySelectorAll(".msnh-reveal");

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("msnh-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );

  msnhRevealItems.forEach((item) => observer.observe(item));
} else {
  msnhRevealItems.forEach((item) => item.classList.add("msnh-visible"));
}

const msnhTestimonialTrack = document.querySelector("[data-testimonial-track]");
const msnhTestimonialPrev = document.querySelector("[data-testimonial-prev]");
const msnhTestimonialNext = document.querySelector("[data-testimonial-next]");

const msnhScrollTestimonials = (direction) => {
  if (!msnhTestimonialTrack) return;
  const card = msnhTestimonialTrack.querySelector(".msnh-testimonial-card");
  const distance = card ? card.getBoundingClientRect().width + 16 : msnhTestimonialTrack.clientWidth;
  msnhTestimonialTrack.scrollBy({ left: distance * direction, behavior: "smooth" });
};

msnhTestimonialPrev?.addEventListener("click", () => msnhScrollTestimonials(-1));
msnhTestimonialNext?.addEventListener("click", () => msnhScrollTestimonials(1));
