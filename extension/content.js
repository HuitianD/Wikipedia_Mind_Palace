// Content script (proposal step 1): adds an "Open in Mind Palace" button to article pages.
// The palace site re-reads the article's sections from the Wikipedia API, so the
// button only needs to pass the title along.
const PALACE_URL = 'http://localhost:8000/'; // change to the deployed (e.g. Vercel) URL

(function addButton() {
  const isArticle = document.body.classList.contains('ns-0') && !location.pathname.includes(':');
  const heading = document.getElementById('firstHeading');
  if (!isArticle || !heading || document.getElementById('wmp-open')) return;
  const title = decodeURIComponent(location.pathname.replace('/wiki/', '')).replace(/_/g, ' ');
  const a = document.createElement('a');
  a.id = 'wmp-open';
  a.href = `${PALACE_URL}?article=${encodeURIComponent(title)}`;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = '🏛️ Open in Mind Palace';
  heading.insertAdjacentElement('afterend', a);
})();
