// O documento persistido é JSON. Só texto e elementos conhecidos voltam ao editor.
const SanotedEditor = (() => {
  const blocks = { P: "paragraph", DIV: "paragraph", H1: "heading", H2: "subheading", BLOCKQUOTE: "quote", PRE: "code" };
  const tags = { paragraph: "p", heading: "h1", subheading: "h2", quote: "blockquote", code: "pre" };
  const marks = { B: "bold", STRONG: "bold", I: "italic", EM: "italic", U: "underline", S: "strike", STRIKE: "strike", DEL: "strike" };
  const markTags = { bold: "strong", italic: "em", underline: "u", strike: "s" };

  function safeLink(value) {
    try {
      const url = new URL(String(value));
      if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password && url.href.length <= 2048) return url.href;
    } catch (_) {}
    return null;
  }

  function textSpans(node, into, active = [], href = null) {
    if (node.nodeType === Node.TEXT_NODE || node.nodeName === "BR") {
      const text = node.nodeName === "BR" ? "\n" : node.nodeValue;
      if (!text) return;
      const previous = into.at(-1);
      if (previous?.href === href && previous.marks.join() === active.join()) previous.text += text;
      else into.push({ text, marks: active, href });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || node.matches("button, input, figure, script, style")) return;
    const style = node.style;
    const selected = [marks[node.tagName]];
    if (style.fontWeight === "bold" || Number(style.fontWeight) >= 600) selected.push("bold");
    if (style.fontStyle === "italic") selected.push("italic");
    const decoration = style.textDecorationLine || style.textDecoration || "";
    if (decoration.includes("underline")) selected.push("underline");
    if (decoration.includes("line-through")) selected.push("strike");
    const next = selected.some(Boolean) ? [...new Set([...active, ...selected.filter(Boolean)])].sort() : active;
    const link = node.tagName === "A" ? safeLink(node.getAttribute("href")) : href;
    for (const child of node.childNodes) textSpans(child, into, next, link);
  }

  function spansIn(element) {
    const spans = [];
    for (const child of element.childNodes) textSpans(child, spans);
    if (spans.length === 1 && spans[0].text === "\n") return [];
    return spans;
  }

  function read(root) {
    const documentBlocks = [];
    let loose = [];
    const finish = () => {
      if (loose.length) documentBlocks.push({ type: "text", style: "paragraph", spans: loose });
      loose = [];
    };
    for (const node of root.childNodes) {
      if (node.nodeType === Node.ELEMENT_NODE && node.matches("figure[data-sanoted-asset]")) {
        finish();
        documentBlocks.push(JSON.parse(node.dataset.sanotedAsset));
      } else if (node.nodeName === "UL" || node.nodeName === "OL") {
        finish();
        documentBlocks.push({ type: "list", style: node.dataset.checklist !== undefined ? "checklist" : node.nodeName === "OL" ? "ordered" : "bullet",
          items: [...node.children].filter(el => el.tagName === "LI").map(li => ({ spans: spansIn(li), checked: li.dataset.checked === "true" })) });
      } else if (blocks[node.nodeName]) {
        finish();
        documentBlocks.push({ type: "text", style: blocks[node.nodeName], spans: spansIn(node) });
      } else textSpans(node, loose);
    }
    finish();
    return documentBlocks;
  }

  function inline(parent, spans) {
    for (const span of spans) {
      let node = document.createTextNode(span.text);
      for (const mark of span.marks || []) {
        if (!markTags[mark]) continue;
        const next = document.createElement(markTags[mark]);
        next.append(node);
        node = next;
      }
      const href = safeLink(span.href);
      if (href) {
        const a = document.createElement("a");
        a.className = "chat-link";
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.append(node);
        node = a;
      }
      parent.append(node);
    }
  }

  function normalizeChecks(root) {
    for (const item of root.querySelectorAll("ul[data-checklist] > li")) {
      let check = item.querySelector(":scope > button[data-note-check]");
      if (!check) {
        check = document.createElement("button");
        check.type = "button";
        check.dataset.noteCheck = "";
        check.setAttribute("role", "checkbox");
        check.setAttribute("contenteditable", "false");
        item.prepend(check);
      }
      const checked = item.dataset.checked === "true";
      if (check.getAttribute("aria-checked") === String(checked)) continue;
      check.setAttribute("aria-checked", String(checked));
      check.setAttribute("aria-label", checked ? "Desmarcar item" : "Marcar item");
      check.replaceChildren(SancordIcons.node(checked ? "check" : "square"));
    }
    root.querySelectorAll("li > button[data-note-check]").forEach(check => {
      if (!check.parentElement.parentElement.matches("ul[data-checklist]")) check.remove();
    });
  }

  function draw(root, documentBlocks, drawAsset) {
    const view = document.createDocumentFragment();
    for (const block of documentBlocks || []) {
      if (block.type === "asset") { view.append(drawAsset(block)); continue; }
      if (block.type === "list") {
        const list = document.createElement(block.style === "ordered" ? "ol" : "ul");
        if (block.style === "checklist") list.dataset.checklist = "";
        for (const entry of block.items) {
          const item = document.createElement("li");
          if (entry.checked) item.dataset.checked = "true";
          inline(item, entry.spans);
          if (!item.childNodes.length) item.append(document.createElement("br"));
          list.append(item);
        }
        view.append(list);
        continue;
      }
      const p = document.createElement(tags[block.style] || "p");
      inline(p, block.spans || []);
      if (!p.childNodes.length) p.append(document.createElement("br"));
      view.append(p);
    }
    root.replaceChildren(view);
    normalizeChecks(root);
  }

  function selection(root) {
    const selected = window.getSelection();
    if (selected?.rangeCount && root.contains(selected.anchorNode) && root.contains(selected.focusNode)) return selected.getRangeAt(0);
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    return range;
  }

  function pasteText(root, text) {
    const range = selection(root);
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
      const label = match[0].replace(/[.,;:!?]+$/, "");
      const href = safeLink(label);
      if (!href) continue;
      fragment.append(document.createTextNode(text.slice(offset, match.index)));
      inline(fragment, [{ text: label, href }]);
      offset = match.index + label.length;
    }
    fragment.append(document.createTextNode(text.slice(offset)));
    const end = fragment.lastChild;
    range.deleteContents();
    range.insertNode(fragment);
    range.setStartAfter(end);
    range.collapse(true);
    const selected = window.getSelection();
    selected.removeAllRanges();
    selected.addRange(range);
  }

  function format(root, command, savedRange) {
    const range = (savedRange && root.contains(savedRange.commonAncestorContainer) ? savedRange : selection(root)).cloneRange();
    root.focus();
    const selected = window.getSelection();
    selected.removeAllRanges();
    selected.addRange(range);
    if (command === "checklist") {
      const ancestor = selected.anchorNode?.parentElement?.closest("ul");
      if (!ancestor || !root.contains(ancestor)) document.execCommand("insertUnorderedList");
      const list = selected.anchorNode?.parentElement?.closest("ul");
      if (list && root.contains(list)) list.toggleAttribute("data-checklist");
    } else if (tags[command]) document.execCommand("formatBlock", false, tags[command]);
    else document.execCommand(command);
    normalizeChecks(root);
  }

  function preview(documentBlocks) {
    return documentBlocks.flatMap(block => block.type === "asset" ? [block.filename, block.caption]
      : block.type === "list" ? block.items.flatMap(item => item.spans.map(span => span.text)) : block.spans.map(span => span.text)).join(" ");
  }

  return { read, draw, safeLink, selection, normalizeChecks, pasteText, format, preview };
})();
