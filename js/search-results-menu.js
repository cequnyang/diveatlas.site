/* One results surface for map, detail, directory and document searches.
   Hosts supply result data and navigation; this module owns the menu DOM,
   interaction and geometry. It deliberately knows nothing about Leaflet or URLs. */
(function (root) {
  "use strict";
  const PAGE_SIZE = 20;
  const escapeHtml = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );

  function highlight(value, queries = []) {
    const text = String(value || "");
    const lower = text.toLocaleLowerCase();
    const ranges = [];
    for (const query of queries) {
      const term = String(query).trim().toLocaleLowerCase();
      if (!term) continue;
      for (
        let at = lower.indexOf(term);
        at >= 0;
        at = lower.indexOf(term, at + term.length)
      ) {
        ranges.push([at, at + term.length]);
      }
    }
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let offset = 0,
      html = "";
    for (const [start, end] of ranges) {
      if (start < offset) continue;
      html +=
        escapeHtml(text.slice(offset, start)) +
        "<strong>" +
        escapeHtml(text.slice(start, end)) +
        "</strong>";
      offset = end;
    }
    return html + escapeHtml(text.slice(offset));
  }

  function create({
    surface,
    scroll,
    getInput,
    filterToggle,
    slot,
    onSelect,
    onMode,
    onLoadMore,
  }) {
    surface.classList.add("search-results-menu");
    let modes = surface.querySelector(".dive-search-modes");
    if (!modes) {
      modes = document.createElement("div");
      modes.className = "dive-search-modes";
      surface.prepend(modes);
    }
    modes.setAttribute("role", "group");
    let renderedQuery = "";
    let destinationState = null;
    let destinationsExpanded = false;
    let viewPositions = {mixed:null,destinations:null};
    let resetScrollOnRender = false;
    let renderedMode = null;
    // Keep the mobile navigation outside the list scrollport so its background
    // spans the scrollbar gutter while the native scrollbar starts below it.
    function syncBackBar() {
      const selector = '.dive-search-result[data-result-kind="back-to-results"]';
      const docked = surface.querySelector(`:scope > ${selector}`);
      const inline = scroll.querySelector(selector);
      const shouldDock = surface.classList.contains("is-mobile-bottom-sheet") && surface.classList.contains("is-destination-results");
      if (shouldDock && inline) {
        surface.insertBefore(inline, scroll);
        scroll.setAttribute("aria-owns", inline.id);
      } else if (!shouldDock && docked) {
        scroll.prepend(docked);
        scroll.removeAttribute("aria-owns");
      }
    }
    function clearBackBar() {
      surface.querySelector(':scope > .dive-search-result[data-result-kind="back-to-results"]')?.remove();
      scroll.removeAttribute("aria-owns");
    }
    function switchDestinationView(next, current) {
      viewPositions[destinationsExpanded ? 'destinations' : 'mixed'] = {...current,scrollTop:scroll.scrollTop};
      destinationsExpanded = next;
      return viewPositions[next ? 'destinations' : 'mixed'] || {
        visibleCount:PAGE_SIZE,activeIndex:next ? 1 : 3,scrollTop:0,
      };
    }
    function groupDestinations(destinations, sites, state, showAllLabel, backLabel) {
      if (state !== destinationState) {
        destinationState = state;
        destinationsExpanded = false;
        viewPositions = {mixed:null,destinations:null};
        resetScrollOnRender = true;
      }
      surface.classList.toggle('is-destination-results', destinationsExpanded);
      // Large result sets use their own paginated view, so they never create
      // thousands of DOM options or bury individual sites in the mixed list.
      if (destinationsExpanded) return [{backToResults:true,name:backLabel,totalDestinations:destinations.length}, ...destinations];
      if (destinations.length <= 3) return [...destinations, ...sites];
      return [...destinations.slice(0, 3), {
        expandDestinations:true, totalDestinations:destinations.length,
        name:showAllLabel(destinations.length),
      }, ...sites];
    }
    function syncFilters({ open, active, pickers }) {
      pickers.forEach((picker) => {
        picker.sync();
        if (!open) picker.close();
      });
      surface.classList.toggle("has-filters", open);
      surface.querySelector(".dive-search-filter-controls").hidden = !open;
      surface.querySelector(".dive-search-filter-clear").hidden = !active;
      filterToggle.classList.toggle("has-active-filters", active);
      filterToggle.setAttribute("aria-expanded", String(open));
      // The menu is portaled; :focus-within alone cannot retain its header anchor.
      slot.classList.toggle("has-search-filters", open);
    }
    surface.addEventListener("mousedown", (event) => {
      if (event.target.closest(".dive-search-result, [data-search-load-more]"))
        event.preventDefault();
    });
    surface.addEventListener("click", (event) => {
      const mode = event.target.closest("[data-search-mode]");
      if (mode) {
        onMode?.(mode.dataset.searchMode);
        return;
      }
      if (event.target.closest("[data-search-load-more]")) {
        onLoadMore();
        return;
      }
      const button = event.target.closest(".dive-search-result");
      // Async catalog refreshes must not select an option for an obsolete query.
      if (button && renderedQuery === getInput().value.trim())
        onSelect(Number(button.dataset.resultIndex), { source: event.detail === 0 ? "keyboard" : "pointer" });
    });

    function updateModes({ mode, labels, areasOnly = false, grouped = false }) {
      const nextMode = grouped ? 'grouped' : mode;
      if (nextMode !== renderedMode) resetScrollOnRender = true;
      renderedMode = nextMode;
      modes.hidden = grouped || areasOnly;
      surface.classList.toggle("is-grouped-search", grouped);
      modes.setAttribute("aria-label", labels.join(" / "));
      if (!modes.children.length)
        modes.innerHTML =
          '<button type="button" data-search-mode="areas"></button><button type="button" data-search-mode="sites"></button>';
      [...modes.children].forEach((button, index) => {
        button.textContent = labels[index];
        button.hidden = areasOnly && index === 1;
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.searchMode === mode),
        );
      });
      surface.classList.toggle("is-area-search", mode === "areas");
    }

    function empty(message, busy = false) {
      renderedQuery = "";
      clearBackBar();
      scroll.removeAttribute("aria-setsize");
      scroll.innerHTML = `<div class="dive-search-empty" role="status">${escapeHtml(message)}</div>`;
      surface.setAttribute("aria-busy", String(busy));
      getInput().removeAttribute("aria-activedescendant");
      scroll.scrollTop = 0;
    }

    function render({
      items,
      total,
      query,
      activeIndex = -1,
      moreLabel,
      queries = [query],
    }) {
      const resetScroll = resetScrollOnRender || query !== renderedQuery;
      renderedQuery = query;
      resetScrollOnRender = false;
      surface.setAttribute("aria-busy", "false");
      scroll.setAttribute("aria-setsize", String(total));
      clearBackBar();
      scroll.innerHTML =
        items
          .map((item, index) => {
            const groupStart = item.group && item.group !== items[index - 1]?.group;
            const groupEnd = item.group && item.group !== items[index + 1]?.group;
            const icon = item.kind === "destination"
              ? '<span class="dive-search-result-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m3 5 6-2 6 3 6-2v15l-6 2-6-3-6 2Z M9 3v15M15 6v15"/></svg></span>'
              : "";
            const prefix = groupStart ? `<div role="group" aria-label="${escapeHtml(item.group)}">` : "";
            const attributes = Object.entries(item.attributes || {})
              .map(([name, value]) => ` data-${name}="${escapeHtml(value)}"`)
              .join("");
            const description = item.description ? ` aria-description="${escapeHtml(item.description)}"` : "";
            const backArrow = item.kind === 'back-to-results'
              ? '<svg class="dive-search-back-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" stroke="currentColor" stroke-width="0.13" d="m12.57 4.205 7.477 7.75.043.045-.043.045-7.478 7.75-.046.047-.046-.045-.734-.71-.046-.044.045-.047 6.195-6.42H3.935v-1.151h14.003l-6.196-6.421-.045-.047.046-.045.734-.709.046-.045z"/></svg>'
              : '';
            const meta = [
              item.meta ? highlight(item.meta, queries) : "",
              item.count ? `<span class="dive-search-result-count">${escapeHtml(item.count)}</span>` : "",
            ].filter(Boolean).join(" · ");
            const content = [
              `<span class="dive-search-result-name">${backArrow}<span class="dive-search-result-title">${highlight(item.name, queries)}</span>${item.badgeHtml || ""}</span>`,
              item.originalName ? `<span class="dive-search-result-original">${highlight(item.originalName, queries)}</span>` : "",
              meta ? `<span class="dive-search-result-meta">${meta}</span>` : "",
            ].join("");
            return `${prefix}<button type="button" class="dive-search-result${item.kind ? ' has-result-kind' : ''}" role="option" id="${surface.id}-option-${index}" data-result-index="${index}" data-match-index="${index}" data-search-query="${escapeHtml(query)}"${item.kind ? ` data-result-kind="${escapeHtml(item.kind)}"` : ''}${attributes}${description} aria-selected="${index === activeIndex}" aria-posinset="${index + 1}" aria-setsize="${total}">${icon}<span class="dive-search-result-copy">${content}</span></button>${groupEnd ? '</div>' : ''}`;
          })
          .join("") +
        (items.length < total
          ? `<button type="button" class="dive-search-load-more" data-search-load-more>${escapeHtml(moreLabel)}</button>`
          : "");
      syncBackBar();
      if (activeIndex >= 0) setActive(activeIndex);
      else getInput().removeAttribute("aria-activedescendant");
      // DOM replacement retains scrollTop; a new query/filter/input must not
      // inherit an unrelated list's offset. Same-list pagination retains it.
      if (resetScroll) scroll.scrollTop = 0;
    }

    function setActive(next) {
      const buttons = [...surface.querySelectorAll(".dive-search-result")];
      const index = buttons.length
        ? Math.max(0, Math.min(next, buttons.length - 1))
        : -1;
      buttons.forEach((button, at) => {
        button.classList.toggle("active", at === index);
        button.setAttribute("aria-selected", String(at === index));
      });
      const active = buttons[index];
      if (active) {
        getInput().setAttribute("aria-activedescendant", active.id);
        active.scrollIntoView({ block: "nearest" });
      } else getInput().removeAttribute("aria-activedescendant");
      return index;
    }

    function keydown(
      event,
      { activeIndex, visibleCount, total, setActive, open, dismiss },
    ) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        open();
        if (activeIndex >= visibleCount - 1 && visibleCount < total)
          onLoadMore();
        setActive(activeIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive(Math.max(0, activeIndex - 1));
      } else if (event.key === "Enter" && activeIndex >= 0) {
        event.preventDefault();
        if (renderedQuery === getInput().value.trim()) onSelect(activeIndex, { source: "keyboard" });
      } else if (
        event.key === "Escape" &&
        surface.classList.contains("visible")
      ) {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }
    }

    function loadMore(renderNext) {
      const top = scroll.scrollTop;
      const focused = document.activeElement?.matches(
        "[data-search-load-more]",
      );
      renderNext();
      if (focused)
        (
          scroll.querySelector("[data-search-load-more]") ||
          [...scroll.querySelectorAll(".dive-search-result")].at(-1)
        )?.focus({ preventScroll: true });
      scroll.scrollTop = top;
    }

    function position({ anchor, filtersOpen, focused, inline = false, fitContent = false, topBoundary = 8, bottomSheet = false }) {
      surface.classList.toggle("is-mobile-bottom-sheet", bottomSheet && window.matchMedia("(max-width:720px)").matches);
      syncBackBar();
      if (surface.classList.contains("is-mobile-bottom-sheet")) {
        const viewport = window.visualViewport;
        const viewportTop = viewport?.offsetTop || 0;
        const bottom = viewportTop + (viewport?.height || window.innerHeight);
        const available = Math.max(0, bottom - viewportTop);
        const collapsedAvailable = Math.max(0, bottom - Math.max(anchor.getBoundingClientRect().bottom + 8, viewportTop));
        const compactHeight = Math.min(collapsedAvailable, Math.max(240, collapsedAvailable * 0.72));
        surface.dataset.compactSheetHeight = String(compactHeight);
        const height = surface.classList.contains("is-sheet-expanded") ? available : compactHeight;
        Object.assign(surface.style, {left: "0px", width: "100%", top: "auto", bottom: `${Math.max(0, window.innerHeight - bottom)}px`, maxHeight: `${available}px`, height: `${height}px`});
        surface.style.setProperty("--search-results-available-height", `${available}px`);
        surface.classList.toggle("is-stacked", filtersOpen);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      if (inline) {
        const minimumTop = Math.max(8, topBoundary);
        surface.dataset.minimumTop = String(minimumTop);
        const below = window.innerHeight - rect.bottom - 20,
          above = Math.max(0, rect.top - 8 - minimumTop);
        // Trip pickers need enough room for their actual rows, not merely a
        // minimum-height menu. Measure at the anchor width before choosing a side.
        surface.style.width = `${Math.min(rect.width, window.innerWidth - 16)}px`;
        const contentHeight = scroll.scrollHeight + Math.max(0, surface.offsetHeight - scroll.clientHeight);
        const requiredHeight = fitContent ? Math.min(440, contentHeight) : 180;
        const opensBelow = below >= requiredHeight || below >= above;
        surface.dataset.placement = opensBelow ? "below" : "above";
        Object.assign(surface.style, {
          left: `${Math.max(8, rect.left)}px`,
          width: `${Math.min(rect.width, window.innerWidth - 16)}px`,
          top: opensBelow ? `${rect.bottom + 8}px` : "auto",
          bottom: opensBelow
            ? "auto"
            : `${window.innerHeight - rect.top + 8}px`,
          maxHeight: `${Math.max(0, Math.min(440, opensBelow ? below : above))}px`,
        });
      } else {
        const mobile = window.matchMedia("(max-width:720px)").matches;
        const style = getComputedStyle(anchor),
          divider = getComputedStyle(anchor, "::after");
        const offset = Math.max(
          0,
          rect.width -
            (parseFloat(style.borderRightWidth) || 0) -
            (parseFloat(divider.right) || 0) -
            (parseFloat(divider.width) || 0),
        );
        const available = Math.max(
          0,
          window.innerWidth - rect.left - offset - 12,
        );
        const filterWidth = mobile ? available : Math.min(360, available) * 0.6;
        const stacked = filtersOpen && filterWidth < 200 && !mobile;
        const base = filtersOpen ? offset : rect.width;
        // Widen narrow phone results to the left without moving the filter divider.
        const expansion =
          mobile && focused && !stacked
            ? Math.min(Math.max(0, 250 - base), Math.max(0, rect.left - 12))
            : 0;
        const width = base + expansion;
        surface.classList.toggle("is-stacked", stacked);
        surface.classList.toggle(
          "is-filter-compact",
          filtersOpen && !stacked && filterWidth < 300,
        );
        if (filtersOpen && !stacked) {
          surface.style.setProperty(
            "--search-results-candidate-width",
            `${Math.max(0, width - 1)}px`,
          );
          surface.style.setProperty(
            "--search-results-filter-width",
            `${filterWidth}px`,
          );
        } else {
          surface.style.removeProperty("--search-results-candidate-width");
          surface.style.removeProperty("--search-results-filter-width");
        }
        const top = Math.max(
          12,
          Math.min(rect.bottom + 8, window.innerHeight - 180),
        );
        Object.assign(surface.style, {
          bottom: "auto",
          left: `${rect.left - expansion}px`,
          top: `${top}px`,
          width: `${filtersOpen && !stacked ? width + filterWidth + 1 : mobile ? width : rect.width}px`,
          maxHeight: `${Math.max(0, Math.min(440, window.innerHeight - top - 12))}px`,
        });
      }
      surface.style.setProperty("--search-results-available-height", surface.style.maxHeight);
      surface.style.removeProperty("height");
    }

    function bindPullPagination(canLoadMore) {
      let diveSearchPullLastY = null;
      let diveSearchPullDistance = 0;
      let diveSearchPullLoaded = false;
      // Require a deliberate pull past the end; reaching the end during a
      // normal list swipe should not immediately request another page.
      const DIVE_SEARCH_PULL_LOAD_DISTANCE = 96;
      let wheelDistance = 0;
      let wheelResetTimer = 0;
      scroll.addEventListener("wheel", (event) => {
        if (window.innerWidth > 720 || !surface.classList.contains("visible") || !canLoadMore()) return;
        const atBottom = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2;
        if (event.deltaY <= 0 || !atBottom) { wheelDistance = 0; return; }
        // Wheel deltas can be pixels, lines, or pages. Normalize before
        // comparing with the touch distance; device acceleration still varies.
        const pixelDelta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * scroll.clientHeight
            : event.deltaY;
        wheelDistance += pixelDelta;
        clearTimeout(wheelResetTimer);
        wheelResetTimer = window.setTimeout(() => { wheelDistance = 0; }, 500);
        if (wheelDistance >= DIVE_SEARCH_PULL_LOAD_DISTANCE) { wheelDistance = 0; onLoadMore(); }
      }, { passive: true });

      scroll.addEventListener(
        "touchstart",
        (event) => {
          if (
            window.innerWidth > 720 ||
            !surface.classList.contains("visible") ||
            event.touches.length !== 1 ||
            !canLoadMore()
          ) {
            diveSearchPullLastY = null;
            return;
          }
          diveSearchPullLastY = event.touches[0].clientY;
          diveSearchPullDistance = 0;
          diveSearchPullLoaded = false;
        },
        { passive: true },
      );

      scroll.addEventListener(
        "touchmove",
        (event) => {
          if (
            diveSearchPullLastY === null ||
            diveSearchPullLoaded ||
            event.touches.length !== 1
          )
            return;
          const currentY = event.touches[0].clientY;
          const upwardMovement = diveSearchPullLastY - currentY;
          diveSearchPullLastY = currentY;
          if (upwardMovement <= 0) {
            diveSearchPullDistance = 0;
            return;
          }

          const atBottom =
            scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2;
          if (!atBottom) {
            diveSearchPullDistance = 0;
            return;
          }

          // Count only the extra upward drag after the scroll area reaches its end,
          // so a normal long swipe through the results does not page unexpectedly.
          diveSearchPullDistance += upwardMovement;
          if (diveSearchPullDistance >= DIVE_SEARCH_PULL_LOAD_DISTANCE) {
            diveSearchPullLoaded = true;
            onLoadMore();
          }
        },
        { passive: true },
      );

      const resetDiveSearchPull = () => {
        diveSearchPullLastY = null;
        diveSearchPullDistance = 0;
        diveSearchPullLoaded = false;
      };
      scroll.addEventListener("touchend", resetDiveSearchPull, {
        passive: true,
      });
      scroll.addEventListener("touchcancel", resetDiveSearchPull, {
        passive: true,
      });
    }

    return {
      groupDestinations,
      expandDestinations: current => switchDestinationView(true,current),
      collapseDestinations: current => switchDestinationView(false,current),
      isDestinationView: () => destinationsExpanded,
      updateModes,
      syncFilters,
      empty,
      render,
      setActive,
      keydown,
      loadMore,
      position,
      bindPullPagination,
      bindMobileHandle: (options) =>
        bindMobileSurface({ results: surface, ...options }),
    };
  }

  function createFilterPicker(
    select,
    {
      id,
      labelledBy,
      mount = null,
      hideSelect = false,
      getPeers,
      getClearLabel,
      getLanguage,
      onDraft,
      clearSelection = true,
      getEmptyLabel = () => 'No matching options',
    },
  ) {
    const source = mount ? "layer" : "search";
    const button = document.createElement("input");
    button.type = "text";
    button.id = id;
    button.className = "dive-filter-picker";
    button.autocomplete = "off";
    button.spellcheck = false;
    button.setAttribute("role", "combobox");
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-autocomplete", "list");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-labelledby", labelledBy);
    button.setAttribute("placeholder", select.options[0]?.textContent || "");
    const list = document.createElement("div");
    list.id = `${id}Options`;
    list.className = "dive-filter-options";
    list.dataset.filterSource = source;
    const scroll = document.createElement("div");
    scroll.className = "dive-filter-options-scroll";
    list.append(scroll);
    list.hidden = true;
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-labelledby", labelledBy);
    button.setAttribute("aria-controls", list.id);
    const wrapper = document.createElement("div");
    wrapper.className = "dive-filter-picker-wrap";
    if (hideSelect) {
      select.hidden = true;
      select.after(wrapper);
    } else {
      mount.append(wrapper);
    }
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "dive-filter-picker-clear";
    clearButton.setAttribute("aria-label", getClearLabel());
    clearButton.title = getClearLabel();
    clearButton.innerHTML =
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m4 4 8 8M12 4l-8 8"/></svg>';
    clearButton.hidden = true;
    wrapper.append(button, clearButton);
    function syncClearButton() {
      const hasContent = Boolean(button.value.trim() || select.value);
      const clearLabel = getClearLabel();
      clearButton.hidden = !hasContent;
      clearButton.setAttribute("aria-label", clearLabel);
      clearButton.title = clearLabel;
      wrapper.classList.toggle("has-clear", hasContent);
    }
    // A body-level options popup avoids clipping in either filter-menu layout.
    document.body.append(list);
    let activeIndex = 0;
    let visibleIndexes = [];
    function close() {
      list.hidden = true;
      button.setAttribute("aria-expanded", "false");
      button.removeAttribute("aria-activedescendant");
    }
    function highlight(visibleIndex) {
      activeIndex = Math.max(
        0,
        Math.min(visibleIndexes.length - 1, visibleIndex),
      );
      Array.from(scroll.children).forEach((option) =>
        option.classList.toggle(
          "is-active",
          Number(option.dataset.optionIndex) === visibleIndexes[activeIndex],
        ),
      );
      const option = scroll.querySelector(
        `[data-option-index="${visibleIndexes[activeIndex]}"]`,
      );
      if (option) {
        button.setAttribute("aria-activedescendant", option.id);
        // scrollIntoView also scrolls ancestors, which closes the popup.
        const top = option.offsetTop;
        if (top < scroll.scrollTop) scroll.scrollTop = top;
        else if (
          top + option.offsetHeight >
          scroll.scrollTop + scroll.clientHeight
        ) {
          scroll.scrollTop = top + option.offsetHeight - scroll.clientHeight;
        }
      }
    }
    function choose(index) {
      if (!Number.isInteger(index) || index < 0 || select.options[index]?.disabled || select.disabled) return;
      select.selectedIndex = index;
      const selectedLabel = select.selectedOptions[0]?.textContent || "";
      button.value = select.value ? selectedLabel : "";
      button.placeholder = selectedLabel;
      close();
      syncClearButton();
      select.dispatchEvent(
        new CustomEvent("change", { bubbles: true, detail: { source } }),
      );
      button.focus({ preventScroll: true });
    }
    function renderOptions(query = "") {
      const normalizedQuery = query.trim().toLocaleLowerCase();
      const matches = Array.from(select.options, (option, index) => ({
        option,
        index,
        label: option.textContent.toLocaleLowerCase(),
      })).filter(
        ({ option, label }) => !option.disabled && (!normalizedQuery || label.includes(normalizedQuery)),
      );
      if (normalizedQuery) {
        matches.sort((a, b) => {
          const aStartsWithQuery = a.label.startsWith(normalizedQuery);
          const bStartsWithQuery = b.label.startsWith(normalizedQuery);
          return (
            Number(bStartsWithQuery) - Number(aStartsWithQuery) ||
            a.option.textContent.localeCompare(
              b.option.textContent,
              getLanguage(),
              { sensitivity: "base" },
            ) ||
            a.index - b.index
          );
        });
      }
      visibleIndexes = matches.map(({ index }) => index);
      scroll.replaceChildren(
        ...visibleIndexes.map((index) => {
          const option = select.options[index];
          const item = document.createElement("div");
          item.id = `${list.id}-${index}`;
          item.className = "dive-filter-option";
          item.dataset.optionIndex = String(index);
          item.setAttribute("role", "option");
          item.setAttribute("aria-selected", String(option.selected));
          const label = option.textContent;
          if (normalizedQuery) {
            const lowerLabel = label.toLocaleLowerCase();
            let offset = 0;
            let matchAt = lowerLabel.indexOf(normalizedQuery, offset);
            while (matchAt !== -1) {
              item.append(
                document.createTextNode(label.slice(offset, matchAt)),
              );
              const match = document.createElement("strong");
              match.textContent = label.slice(
                matchAt,
                matchAt + normalizedQuery.length,
              );
              item.append(match);
              offset = matchAt + normalizedQuery.length;
              matchAt = lowerLabel.indexOf(normalizedQuery, offset);
            }
            item.append(document.createTextNode(label.slice(offset)));
          } else {
            item.textContent = label;
          }
          item.addEventListener("click", () => choose(index));
          return item;
        }),
      );
      if (!visibleIndexes.length) {
        const empty = document.createElement("div");
        empty.className = "dive-filter-option";
        empty.setAttribute("aria-disabled", "true");
        empty.textContent = getEmptyLabel();
        scroll.append(empty);
      }
    }
    function positionList() {
      const rect = button.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upwards = below < 160 && above > below;
      const height = Math.min(280, Math.max(40, upwards ? above : below));
      list.style.width = `${Math.min(Math.max(rect.width, 180), window.innerWidth - 16)}px`;
      list.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - parseFloat(list.style.width) - 8))}px`;
      list.style.maxHeight = `${height}px`;
      // Reserve the shell's padding and border so the scrollbar stays inside its corners.
      scroll.style.maxHeight = `${height - 14}px`;
      list.style.top = upwards ? "auto" : `${rect.bottom + 4}px`;
      list.style.bottom = upwards
        ? `${window.innerHeight - rect.top + 4}px`
        : "auto";
    }
    function open() {
      getPeers().forEach((picker) => picker.close());
      renderOptions(button.value);
      positionList();
      list.hidden = false;
      button.setAttribute("aria-expanded", "true");
      const selectedVisibleIndex = visibleIndexes.indexOf(
        Math.max(0, select.selectedIndex),
      );
      highlight(selectedVisibleIndex >= 0 ? selectedVisibleIndex : 0);
    }
    button.addEventListener("click", open);
    button.addEventListener("input", () => {
      syncClearButton();
      if (list.hidden) open();
      else {
        renderOptions(button.value);
        positionList();
        highlight(0);
      }
      onDraft(source);
    });
    button.addEventListener("focus", () => button.select());
    button.addEventListener("keydown", (event) => {
      if (event.key === "Tab") {
        close();
        return;
      }
      if (event.key === "Escape") {
        if (!list.hidden) {
          event.preventDefault();
          event.stopPropagation();
          button.value = select.value
            ? select.selectedOptions[0]?.textContent || ""
            : "";
          syncClearButton();
          close();
        }
        return;
      }
      if (
        ["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(event.key)
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (list.hidden) {
          open();
          return;
        }
        if (event.key === "Enter" && visibleIndexes.length)
          choose(visibleIndexes[activeIndex]);
        else
          highlight(
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? visibleIndexes.length - 1
                : activeIndex + (event.key === "ArrowDown" ? 1 : -1),
          );
      }
    });
    button.addEventListener("blur", () => close());
    clearButton.addEventListener("mousedown", (event) =>
      event.preventDefault(),
    );
    clearButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      // Required pickers clear their search draft without discarding the
      // committed selection. Optional filters retain their normal clear action.
      if (clearSelection) select.value = "";
      button.value = "";
      close();
      syncClearButton();
      if (clearSelection) select.dispatchEvent(
        new CustomEvent("change", { bubbles: true, detail: { source } }),
      );
      button.focus({ preventScroll: true });
      if (!clearSelection) open();
    });
    // Retain combobox focus while clicking or dragging inside its popup.
    list.addEventListener("mousedown", (event) => {
      if (event.target.closest(".dive-filter-option")) event.preventDefault();
    });
    document.addEventListener("pointerdown", (event) => {
      if (!button.contains(event.target) && !list.contains(event.target))
        close();
    });
    window.addEventListener("resize", close);
    document.addEventListener(
      "scroll",
      (event) => {
        // A long query scrolls the input's text horizontally as the caret moves.
        // That is not a page scroll and must not dismiss the matching options.
        if (event.target !== button && !list.contains(event.target)) close();
      },
      true,
    );
    return {
      select,
      input: button,
      close,
      sync() {
        const selected = select.selectedOptions[0]?.textContent || "";
        if (document.activeElement !== button)
          button.value = select.value ? selected : "";
        button.placeholder = selected;
        syncClearButton();
      },
    };
  }

  function bindMobileSurface({
    results,
    resultsHandle,
    onDismiss,
    returnFocus,
    isBottomSheet = () => false,
    onSheetResize = () => {},
    followStretch = false,
    contentScroll = null,
    isVisible = () => results.classList.contains("visible"),
  }) {
    if (!resultsHandle) return { cancel() {}, dismiss: onDismiss };
    const mobileLayoutQuery = window.matchMedia("(max-width:720px)");
    let handleDismissal = null,
      handleResetTransition = null,
      handleResetMaxHeight = "";
    function cancel() {
      if (isBottomSheet()) root.DiveAtlasSheetMotion.cancelExit(results);
      if (handleDismissal) {
        clearTimeout(handleDismissal.timer);
        results.removeEventListener(
          "transitionend",
          handleDismissal.onTransitionEnd,
        );
        handleDismissal = null;
      }
      if (handleResetTransition) {
        results.removeEventListener("transitionend", handleResetTransition);
        handleResetTransition = null;
        if (handleResetMaxHeight)
          results.style.maxHeight = handleResetMaxHeight;
        else results.style.removeProperty("max-height");
        handleResetMaxHeight = "";
      }
      results.classList.remove(
        "mobile-search-dismissing",
        "mobile-search-restoring",
        "mobile-vertical-dragging",
      );
      results.style.removeProperty("--mobile-handle-stretch");
      if (!isBottomSheet()) results.style.removeProperty("height");
    }

    let drag = null;
    const reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const restoreMaxHeight = (value) => {
      if (value) results.style.maxHeight = value;
      else results.style.removeProperty("max-height");
    };
    const resetDrag = (startHeight, startMaxHeight) => {
      if (handleResetTransition) {
        results.removeEventListener("transitionend", handleResetTransition);
        handleResetTransition = null;
        restoreMaxHeight(handleResetMaxHeight);
        handleResetMaxHeight = "";
      }
      results.classList.remove("mobile-vertical-dragging");
      results.classList.add("mobile-search-restoring");
      results.style.removeProperty("--mobile-handle-stretch");
      results.style.removeProperty("--mobile-panel-drag-y");
      const currentHeight = results.getBoundingClientRect().height;
      if (
        reducedMotionQuery.matches ||
        Math.abs(currentHeight - startHeight) < 1
      ) {
        results.style.removeProperty("height");
        restoreMaxHeight(startMaxHeight);
        results.classList.remove("mobile-search-restoring");
        return;
      }
      results.style.height = `${startHeight}px`;
      handleResetMaxHeight = startMaxHeight;
      handleResetTransition = (event) => {
        if (
          event.target !== results ||
          event.propertyName !== "height" ||
          results.classList.contains("mobile-vertical-dragging")
        )
          return;
        results.removeEventListener("transitionend", handleResetTransition);
        results.style.removeProperty("height");
        restoreMaxHeight(handleResetMaxHeight);
        handleResetTransition = null;
        handleResetMaxHeight = "";
        results.classList.remove("mobile-search-restoring");
      };
      results.addEventListener("transitionend", handleResetTransition);
    };
    const dismiss = (completeDismissal = onDismiss) => {
      if (isBottomSheet()) {
        if (!isVisible()) { completeDismissal(); return; }
        root.DiveAtlasSheetMotion.exit(results, completeDismissal);
        return;
      }
      if (handleDismissal) return;
      if (!isVisible() || !mobileLayoutQuery.matches || reducedMotionQuery.matches) {
        completeDismissal();
        return;
      }
      results.classList.remove("mobile-vertical-dragging");
      results.classList.add("mobile-search-dismissing");
      results.style.removeProperty("--mobile-panel-drag-y");
      if (!results.style.height)
        results.style.height = `${results.getBoundingClientRect().height}px`;
      void results.offsetHeight;
      results.style.height = "0px";
      const complete = () => {
        if (handleDismissal !== dismissal) return;
        clearTimeout(dismissal.timer);
        results.removeEventListener("transitionend", dismissal.onTransitionEnd);
        handleDismissal = null;
        results.classList.remove("mobile-search-dismissing");
        completeDismissal();
      };
      const dismissal = {
        timer: 0,
        onTransitionEnd: (event) => {
          if (event.target === results && event.propertyName === "height")
            complete();
        },
      };
      handleDismissal = dismissal;
      results.addEventListener("transitionend", dismissal.onTransitionEnd);
      dismissal.timer = window.setTimeout(complete, 280);
    };

    // The list keeps native scrolling until a downward gesture reaches its top.
    // From that point only the remaining movement controls the sheet.
    let contentDrag = null;
    contentScroll?.addEventListener("touchstart", (event) => {
      if (!mobileLayoutQuery.matches || !isBottomSheet() || !isVisible() || event.touches.length !== 1) return;
      const touch = event.touches[0];
      contentDrag = { id: touch.identifier, x: touch.clientX, lastY: touch.clientY, startY: null };
    }, { passive: true });
    contentScroll?.addEventListener("touchmove", (event) => {
      if (!contentDrag || event.touches.length !== 1) return;
      const touch = [...event.touches].find(item => item.identifier === contentDrag.id);
      if (!touch) return;
      const step = touch.clientY - contentDrag.lastY;
      contentDrag.lastY = touch.clientY;
      if (contentDrag.startY === null) {
        if (step <= 0 || contentScroll.scrollTop > 0 || Math.abs(touch.clientX - contentDrag.x) > Math.abs(step) * 2) return;
        contentDrag.startY = touch.clientY - step;
        contentDrag.startHeight = results.getBoundingClientRect().height;
        contentDrag.maxHeight = parseFloat(results.style.maxHeight) || window.innerHeight;
        contentDrag.expanded = results.classList.contains("is-sheet-expanded");
      }
      const dy = Math.max(0, touch.clientY - contentDrag.startY);
      if (event.cancelable) event.preventDefault();
      results.classList.add("mobile-vertical-dragging");
      results.style.height = `${Math.max(200, Math.min(contentDrag.maxHeight, contentDrag.startHeight - dy))}px`;
    }, { passive: false });
    function finishContentDrag(event, cancelled = false) {
      if (!contentDrag) return;
      const touch = [...event.changedTouches].find(item => item.identifier === contentDrag.id);
      const active = contentDrag.startY !== null;
      const dy = active && touch ? touch.clientY - contentDrag.startY : 0;
      const expanded = contentDrag.expanded;
      const startHeight = contentDrag.startHeight;
      contentDrag = null;
      if (!active) return;
      results.classList.remove("mobile-vertical-dragging");
      const compactHeight = Number(results.dataset.compactSheetHeight) || startHeight;
      if (!cancelled && dy >= 72 && startHeight - dy <= compactHeight - 72) dismiss();
      else {
        if (!cancelled && dy >= 40 && expanded) results.classList.remove("is-sheet-expanded");
        onSheetResize();
      }
    }
    contentScroll?.addEventListener("touchend", event => finishContentDrag(event), { passive: true });
    contentScroll?.addEventListener("touchcancel", event => finishContentDrag(event, true), { passive: true });

    resultsHandle.addEventListener("pointerdown", (event) => {
      if (
        !mobileLayoutQuery.matches ||
        !isVisible() ||
        event.button !== 0
      )
        return;
      if (handleResetTransition) {
        results.removeEventListener("transitionend", handleResetTransition);
        handleResetTransition = null;
        restoreMaxHeight(handleResetMaxHeight);
        handleResetMaxHeight = "";
        results.classList.remove("mobile-search-restoring");
        results.style.removeProperty("height");
      }
      if (isBottomSheet()) {
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, sheet: true, expanded: results.classList.contains("is-sheet-expanded"), startHeight: results.getBoundingClientRect().height, maxHeight: parseFloat(results.style.maxHeight) || window.innerHeight };
        resultsHandle.setPointerCapture?.(event.pointerId);
        return;
      }
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        direction: results.dataset.placement === 'above' ? -1 : 1,
        expansionRoom: results.dataset.placement === 'above'
          ? Math.max(0, results.getBoundingClientRect().top - (Number(results.dataset.minimumTop) || 8))
          : Math.max(0, window.innerHeight - results.getBoundingClientRect().bottom - 8),
        startHeight: results.getBoundingClientRect().height,
        startMaxHeight: results.style.maxHeight,
        moved: false,
        hasMovedUpward: false,
        hasResizedSheet: false,
      };
      resultsHandle.setPointerCapture?.(event.pointerId);
    });
    resultsHandle.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      if (drag.sheet) {
        const dy = event.clientY - drag.y;
        if (Math.abs(dy) > 5 && Math.abs(dy) > Math.abs(event.clientX - drag.x) * 1.2) {
          if (event.cancelable) event.preventDefault();
          results.classList.add("mobile-vertical-dragging");
          results.style.height = `${Math.max(200, Math.min(drag.maxHeight, drag.startHeight - dy))}px`;
        }
        return;
      }
      const deltaX = event.clientX - drag.x;
      const deltaY = (event.clientY - drag.y) * drag.direction;
      if (Math.hypot(deltaX, deltaY) < 4) return;
      if (Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
        drag.moved = true;
        return;
      }
      drag.moved = true;
      if (event.cancelable) event.preventDefault();
      if (deltaY < 0) drag.hasMovedUpward = true;
      drag.hasResizedSheet = true;
      results.classList.add("mobile-vertical-dragging");
      const downwardStretch = Math.min(
        20 * (1 - Math.exp(-Math.max(0, deltaY) / 18)),
        drag.expansionRoom,
      );
      if (followStretch) results.style.setProperty("--mobile-handle-stretch", `${deltaY > 0 ? downwardStretch : 0}px`);
      if (deltaY > 0) results.style.maxHeight = "none";
      else restoreMaxHeight(drag.startMaxHeight);
      const height =
        deltaY < 0
          ? Math.max(72, drag.startHeight + deltaY)
          : drag.startHeight + downwardStretch;
      results.style.height = `${height}px`;
    });
    const finishDrag = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      if (drag.sheet) {
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        const vertical = Math.abs(dy) > Math.abs(dx) * 1.2;
        const compactHeight = Number(results.dataset.compactSheetHeight) || drag.startHeight;
        const closeSheet = vertical && dy >= 72 && drag.startHeight - dy <= compactHeight - 72;
        if (vertical && Math.abs(dy) >= 40) {
          results.classList.toggle("is-sheet-expanded", dy < 0);
          event.preventDefault();
        }
        results.classList.remove("mobile-vertical-dragging");
        drag = null;
        // The dismissal threshold is tied to the compact sheet position, so
        // a continuous pull from full-screen can cross it without stopping.
        if (closeSheet) dismiss();
        else onSheetResize();
        return;
      }
      const deltaX = event.clientX - drag.x;
      const deltaY = (event.clientY - drag.y) * drag.direction;
      const didMove = drag.moved;
      const hasMovedUpward = drag.hasMovedUpward;
      const hasResizedSheet = drag.hasResizedSheet;
      const finalCollapseDistance = Math.max(0, -deltaY);
      const upwardDrag =
        didMove &&
        hasMovedUpward &&
        deltaY < 0 &&
        Math.abs(deltaY) > Math.abs(deltaX) * 1.2;
      const startHeight = drag.startHeight;
      const startMaxHeight = drag.startMaxHeight;
      drag = null;
      if (upwardDrag) event.preventDefault();
      // Normalized negative motion always collapses toward the selector.
      if (upwardDrag && finalCollapseDistance >= 72) {
        dismiss();
        return;
      }
      if (hasResizedSheet) resetDrag(startHeight, startMaxHeight);
      else if (didMove) {
        results.classList.remove("mobile-vertical-dragging");
        results.style.removeProperty("--mobile-panel-drag-y");
      }
    };
    resultsHandle.addEventListener("pointerup", finishDrag);
    resultsHandle.addEventListener("pointercancel", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      if (drag.sheet) { drag = null; results.classList.remove("mobile-vertical-dragging"); onSheetResize(); return; }
      const startHeight = drag.startHeight;
      const startMaxHeight = drag.startMaxHeight;
      const hasResizedSheet = drag.hasResizedSheet;
      drag = null;
      if (hasResizedSheet) resetDrag(startHeight, startMaxHeight);
      else {
        results.classList.remove("mobile-vertical-dragging");
        results.style.removeProperty("--mobile-panel-drag-y");
      }
    });
    resultsHandle.addEventListener("click", (event) => {
      if (event.detail === 0 && mobileLayoutQuery.matches && isBottomSheet()) {
        results.classList.toggle("is-sheet-expanded");
        onSheetResize();
        return;
      }
      if (event.detail === 0 && mobileLayoutQuery.matches) {
        onDismiss();
        returnFocus?.focus({ preventScroll: true });
      }
    });
    return { cancel, dismiss };
  }

  root.DiveAtlasSearchResultsMenu = { create, highlight, createFilterPicker, bindMobileSurface, pageSize:PAGE_SIZE };
})(window);
