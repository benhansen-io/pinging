document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".dark-mode").forEach((elem) =>
    elem.addEventListener("click", (event) => {
      let next;
      let src;
      switch (event.target.id) {
        case "dark-mode-auto":
          next = "dark";
          break;
        case "dark-mode-dark":
          next = "light";
          break;
        case "dark-mode-light":
          next = "auto";
          break;
        default:
          return console.error("Unknown case");
      }
      switchDarkMode(next);
    })
  );
});

function switchDarkMode(mode: string) {
  document
    .querySelectorAll(".dark-mode")
    .forEach((elem) => (elem.style.display = "none"));
  let nextElem = document.getElementById("dark-mode-" + mode);
  nextElem.style.display = "initial";
  document.documentElement.classList.remove("light");
  document.documentElement.classList.remove("dark");
  document.documentElement.classList.remove("auto");
  if (mode == "auto") {
    localStorage.removeItem("dark-mode");
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      mode = "dark";
    } else {
      mode = "light";
    }
  } else {
    localStorage.setItem("dark-mode", mode);
  }
  document.documentElement.classList.add(mode);
}
function readUsersDarkModePreference() {
  let mode = localStorage.getItem("dark-mode");
  if (mode === null) {
    mode = "auto";
  }
  // Attach the correct html tag class now
  document.documentElement.classList.add(mode);
  // Do a full switch (with icons) after we have them loaded
  document.addEventListener("DOMContentLoaded", () => {
    switchDarkMode(mode);
  });
}
readUsersDarkModePreference();
