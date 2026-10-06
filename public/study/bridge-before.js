// Runs before the study app. The surrounding app opens this page as /study/index.html?u=<user id>.
(function () {
  var u = new URLSearchParams(location.search).get("u") || "guest";
  window.TAKKEN_STORE_KEY = "tdb-study-" + u; // one study record per employee, even on a shared PC
  window.TAKKEN_DATA_BASE = "https://takken-drill.com/"; // detailed explanations
  window.TAKKEN_CONFIG = { stripeReady: false }; // no login, payments or ads inside the company app
})();
