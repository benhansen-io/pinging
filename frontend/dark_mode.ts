const darkModeButtons = document.querySelectorAll(".dark-mode");
darkModeButtons.forEach((elem) =>
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
function switchDarkMode(mode: string) {
  darkModeButtons.forEach((elem) => (elem.style.display = "none"));
  let nextElem = document.getElementById("dark-mode-" + mode);
  nextElem.style.display = "initial";
  document.body.classList.remove("light");
  document.body.classList.remove("dark");
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
  document.body.classList.add(mode);
}
function readUsersDarkModePreference() {
  let mode = localStorage.getItem("dark-mode");
  if (mode === null) {
    mode = "auto";
  }
  switchDarkMode(mode);
}
readUsersDarkModePreference();
