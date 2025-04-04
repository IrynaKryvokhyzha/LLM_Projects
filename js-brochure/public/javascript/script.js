document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("brochureForm");
  const outputDiv = document.getElementById("output");
  const loadingSpinner = document.getElementById("loading");

  // Force dark mode
  function forceDarkMode() {
    document.documentElement.setAttribute("data-bs-theme", "dark");
  }

  // Call immediately and whenever the page loads/reloads
  forceDarkMode();
  window.addEventListener("load", forceDarkMode);

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    const companyName = document.getElementById("companyName").value;
    const url = document.getElementById("url").value;
    const model = document.getElementById("model").value;

    if (!companyName || !url) {
      alert("Please fill out all fields");
      return;
    }

    // Clear previous content and show loading spinner
    outputDiv.innerHTML = "";
    loadingSpinner.classList.remove("d-none");

    let connectionId;
    let fullResponse = ""; // <-- Declare this variable

    // Start SSE connection
    const eventSource = new EventSource(`/generate-brochure?_=${Date.now()}`);

    // Define onmessage handler ONCE
    eventSource.onmessage = function (event) {
      const data = JSON.parse(event.data);

      if (data.connectionId) {
        connectionId = data.connectionId;

        // Send the actual request
        fetch("/generate-brochure", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            companyName,
            url,
            model,
            connectionId, // Include the connection ID
          }),
        });
      }

      if (data.error) {
        outputDiv.innerHTML = `<div class="alert alert-danger">${data.error}</div>`;
        eventSource.close();
        loadingSpinner.classList.add("d-none");
        return;
      }

      if (data.done) {
        eventSource.close();
        loadingSpinner.classList.add("d-none");
        return;
      }

      if (data.chunk) {
        fullResponse += data.chunk;
        // Render markdown
        outputDiv.innerHTML = marked.parse(fullResponse);
      }
    };

    // Define onerror handler at the same level as onmessage
    eventSource.onerror = function () {
      eventSource.close();
      loadingSpinner.classList.add("d-none");
      if (!fullResponse) {
        outputDiv.innerHTML =
          '<div class="alert alert-danger">Error connecting to server</div>';
      }
    };
  });
});
