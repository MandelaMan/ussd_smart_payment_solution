/**
 * Starlynx lead form embeddable widget.
 *
 * Usage:
 *   <div id="starlynx-lead-form"></div>
 *   <script src="https://YOUR_HOST/leads/embed.js" async></script>
 *
 * Or with options:
 *   <script>
 *     window.StarlynxLead = { target: '#my-div', apiBase: 'https://YOUR_HOST' };
 *   </script>
 *   <script src="https://YOUR_HOST/leads/embed.js" async></script>
 */
(function () {
  "use strict";

  var script =
    document.currentScript ||
    (function () {
      var tags = document.getElementsByTagName("script");
      return tags[tags.length - 1];
    })();

  var scriptSrc = (script && script.src) || "";
  var originMatch = scriptSrc.match(/^(https?:\/\/[^/]+)/i);
  var defaultOrigin = originMatch ? originMatch[1] : "";

  var opts = window.StarlynxLead || {};
  var apiBase = String(opts.apiBase || defaultOrigin || "").replace(/\/$/, "");
  var targetSel = opts.target || "#starlynx-lead-form";
  var target = document.querySelector(targetSel);

  if (!target) {
    target = document.createElement("div");
    target.id = "starlynx-lead-form";
    if (script && script.parentNode) {
      script.parentNode.insertBefore(target, script);
    } else {
      document.body.appendChild(target);
    }
  }

  var css = document.createElement("style");
  css.textContent =
    ".slx-lead{font-family:DM Sans,Segoe UI,system-ui,sans-serif;color:#0a3744;max-width:440px}" +
    ".slx-lead *{box-sizing:border-box}" +
    ".slx-lead h2{font-size:1.35rem;margin:0 0 6px;color:#0e4858}" +
    ".slx-lead p{margin:0 0 14px;color:#4a6b75;font-size:.95rem;line-height:1.45}" +
    ".slx-lead label{display:block;font-size:.78rem;font-weight:600;margin:0 0 5px;color:#0e4858}" +
    ".slx-lead .f{margin-bottom:10px}" +
    ".slx-lead input,.slx-lead select,.slx-lead textarea{width:100%;border:1px solid rgba(22,106,130,.2);border-radius:10px;padding:10px 11px;font:inherit;background:#fff}" +
    ".slx-lead button{width:100%;margin-top:6px;border:0;border-radius:999px;padding:12px 16px;font:inherit;font-weight:700;color:#fff;background:linear-gradient(135deg,#166a82,#0e4858);cursor:pointer}" +
    ".slx-lead button:disabled{opacity:.65}" +
    ".slx-lead .msg{display:none;margin-top:10px;padding:10px 12px;border-radius:10px;font-size:.9rem}" +
    ".slx-lead .ok{display:block;background:rgba(234,238,171,.65)}" +
    ".slx-lead .err{display:block;background:rgba(249,164,86,.25);color:#8a3b00}" +
    ".slx-lead .hp{position:absolute;left:-9999px;height:0;overflow:hidden}";
  document.head.appendChild(css);

  if (!document.querySelector('link[data-slx-font="1"]')) {
    var font = document.createElement("link");
    font.rel = "stylesheet";
    font.setAttribute("data-slx-font", "1");
    font.href =
      "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap";
    document.head.appendChild(font);
  }

  target.innerHTML =
    '<div class="slx-lead">' +
    "<h2>Loading…</h2>" +
    "<p>Please wait</p>" +
    "</div>";

  function render(cfg) {
    var interests = (cfg.interests || [])
      .map(function (i) {
        return (
          '<option value="' +
          escapeHtml(i.value) +
          '">' +
          escapeHtml(i.label) +
          "</option>"
        );
      })
      .join("");

    target.innerHTML =
      '<div class="slx-lead">' +
      "<h2>" +
      escapeHtml(cfg.title || "Get connected") +
      "</h2>" +
      "<p>" +
      escapeHtml(cfg.subtitle || "") +
      "</p>" +
      '<form id="slx-lead-form">' +
      '<div class="hp" aria-hidden="true"><input name="companyWebsite" tabindex="-1" autocomplete="off" /></div>' +
      '<div class="f"><label>Full name</label><input name="name" required /></div>' +
      '<div class="f"><label>Phone</label><input name="phone" required /></div>' +
      '<div class="f"><label>Email (optional)</label><input name="email" type="email" /></div>' +
      '<div class="f"><label>Interest</label><select name="interest">' +
      interests +
      "</select></div>" +
      '<div class="f"><label>Building / estate</label><input name="buildingInterest" /></div>' +
      '<div class="f"><label>Message</label><textarea name="message" rows="3"></textarea></div>' +
      '<button type="submit">Send request</button>' +
      '<div class="msg" id="slx-feedback"></div>' +
      "</form></div>";

    var form = target.querySelector("#slx-lead-form");
    var feedback = target.querySelector("#slx-feedback");
    var btn = form.querySelector('button[type="submit"]');

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      btn.disabled = true;
      feedback.className = "msg";
      var payload = {
        source: "embed",
        name: form.name.value,
        phone: form.phone.value,
        email: form.email.value,
        interest: form.interest.value,
        buildingInterest: form.buildingInterest.value,
        message: form.message.value,
        companyWebsite: form.companyWebsite.value,
        pageUrl: window.location.href,
      };
      fetch(apiBase + "/api/public/leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Lead-Source": "embed",
        },
        body: JSON.stringify(payload),
      })
        .then(function (r) {
          return r.json().then(function (body) {
            if (!r.ok) throw new Error(body.error || "Failed");
            return body;
          });
        })
        .then(function (body) {
          form.reset();
          feedback.className = "msg ok";
          feedback.textContent =
            body.message || cfg.successMessage || "Thanks!";
        })
        .catch(function (err) {
          feedback.className = "msg err";
          feedback.textContent = err.message || "Something went wrong";
        })
        .finally(function () {
          btn.disabled = false;
        });
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  fetch(apiBase + "/api/public/leads/config")
    .then(function (r) {
      return r.json();
    })
    .then(render)
    .catch(function () {
      render({
        title: "Get connected",
        subtitle: "Leave your details and we will follow up.",
        interests: [
          { value: "Home Internet", label: "Home Internet" },
          { value: "Internet + DSTV", label: "Internet + DSTV" },
          { value: "Business", label: "Business" },
          { value: "Other", label: "Other" },
        ],
      });
    });
})();
