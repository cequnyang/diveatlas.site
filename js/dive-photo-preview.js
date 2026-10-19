(() => {
  let dialog = null;

  function getDialog(labels) {
    if (dialog?.isConnected) {
      dialog.setAttribute('aria-label', labels.preview);
      dialog.querySelector('.dive-photo-preview__close')?.setAttribute('aria-label', labels.close);
      return dialog;
    }

    dialog = document.createElement('dialog');
    dialog.className = 'dive-photo-preview';
    dialog.setAttribute('aria-label', labels.preview);

    const closeButton = document.createElement('button');
    closeButton.className = 'dive-photo-preview__close';
    closeButton.type = 'button';
    closeButton.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/></svg>';
    closeButton.setAttribute('aria-label', labels.close);

    const layout = document.createElement('div');
    layout.className = 'dive-photo-preview__layout';
    const imagePane = document.createElement('div');
    imagePane.className = 'dive-photo-preview__image-pane';
    const image = document.createElement('img');
    image.className = 'dive-photo-preview__image';
    imagePane.append(image);
    const rail = document.createElement('aside');
    rail.className = 'dive-photo-preview__rail';
    rail.setAttribute('aria-label', 'Dive site photos');
    const thumbnail = document.createElement('button');
    thumbnail.className = 'dive-photo-preview__thumbnail';
    thumbnail.type = 'button';
    thumbnail.setAttribute('aria-label', 'Current photo');
    thumbnail.setAttribute('aria-pressed', 'true');
    const thumbnailImage = document.createElement('img');
    thumbnailImage.alt = '';
    thumbnail.append(thumbnailImage);
    thumbnail.addEventListener('click', event => event.stopPropagation());
    const addPhoto = document.createElement('a');
    addPhoto.className = 'dive-photo-preview__add-photo';
    addPhoto.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/></svg><span>Add photo</span>';
    addPhoto.addEventListener('click', event => event.stopPropagation());
    rail.append(thumbnail, addPhoto);
    const credit = document.createElement('div');
    credit.className = 'dive-photo-preview__credit';
    imagePane.append(credit);
    layout.append(imagePane, rail);
    dialog.append(closeButton, layout);

    closeButton.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      if (!dialog.open) return;
      const bounds = image.getBoundingClientRect();
      const scale = image.naturalWidth && image.naturalHeight
        ? Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight)
        : 0;
      const photoWidth = image.naturalWidth * scale;
      const photoHeight = image.naturalHeight * scale;
      const photoLeft = bounds.left;
      const photoTop = bounds.top + (bounds.height - photoHeight) / 2;
      const clickedPhoto = scale > 0 && event.clientX >= photoLeft && event.clientX <= photoLeft + photoWidth &&
        event.clientY >= photoTop && event.clientY <= photoTop + photoHeight;
      if (!clickedPhoto) dialog.close();
    });

    const alignCreditWithPhoto = () => {
      if (!dialog.open || !image.naturalWidth || !image.naturalHeight) return;
      const bounds = image.getBoundingClientRect();
      const scale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
      const photoLeft = bounds.left;
      credit.style.left = `${Math.round(photoLeft)}px`;
      credit.style.maxWidth = `min(50vw, ${Math.max(0, window.innerWidth - photoLeft - 16)}px)`;
    };
    image.addEventListener('load', alignCreditWithPhoto);
    window.addEventListener('resize', alignCreditWithPhoto);
    dialog.addEventListener('close', () => {
      image.removeAttribute('src');
      dialog._diveAtlasBackgroundPopup?.classList.remove('dive-site-popup--photo-previewing');
      dialog._diveAtlasBackgroundPopup = null;
    });
    document.body.append(dialog);
    return dialog;
  }

  window.DiveAtlasPhotoPreview = {
    open({ src, alt, credit }, { previewLabel = 'Photo preview', closeLabel = 'Close photo preview', popup = null, addPhotoUrl, onAddPhoto } = {}) {
      if (!src) return;
      const activeDialog = getDialog({ preview: previewLabel, close: closeLabel });
      const image = activeDialog.querySelector('.dive-photo-preview__image');
      const creditElement = activeDialog.querySelector('.dive-photo-preview__credit');
      const thumbnail = activeDialog.querySelector('.dive-photo-preview__thumbnail img');
      const addPhotoButton = activeDialog.querySelector('.dive-photo-preview__add-photo');
      image.src = src;
      image.alt = alt || '';
      thumbnail.src = src;
      thumbnail.alt = '';
      creditElement.textContent = credit || '';
      addPhotoButton.hidden = !addPhotoUrl && typeof onAddPhoto !== 'function';
      if (addPhotoUrl) {
        addPhotoButton.href = addPhotoUrl;
        addPhotoButton.removeAttribute('role');
        addPhotoButton.removeAttribute('tabindex');
        addPhotoButton.onclick = null;
      } else {
        addPhotoButton.removeAttribute('href');
        addPhotoButton.setAttribute('role', 'button');
        addPhotoButton.tabIndex = 0;
        addPhotoButton.onclick = event => {
          event.preventDefault();
          if (typeof onAddPhoto !== 'function') return;
          activeDialog.close();
          onAddPhoto();
        };
      }
      if (!activeDialog.open) {
        activeDialog.showModal();
        const backgroundPopup = popup?.getElement?.();
        if (backgroundPopup?.classList.contains('dive-site-popup')) {
          backgroundPopup.classList.add('dive-site-popup--photo-previewing');
          activeDialog._diveAtlasBackgroundPopup = backgroundPopup;
        }
      }
    }
  };
})();
