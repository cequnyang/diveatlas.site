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
    const credit = document.createElement('div');
    credit.className = 'dive-photo-preview__credit';
    credit.setAttribute('aria-live', 'polite');
    credit.setAttribute('aria-atomic', 'true');
    credit.addEventListener('click', event => event.stopPropagation());
    layout.append(imagePane, credit, rail);
    dialog.append(closeButton, layout);

    closeButton.addEventListener('click', () => dialog.close());
    rail.addEventListener('click', event => {
      const thumbnail = event.target.closest('.dive-photo-preview__thumbnail');
      if (!thumbnail || !rail.contains(thumbnail)) return;
      event.stopPropagation();
      const selectedPhoto = dialog._diveAtlasPhotos?.[Number(thumbnail.dataset.photoIndex)];
      if (!selectedPhoto) return;
      image.src = selectedPhoto.src;
      image.alt = selectedPhoto.alt;
      credit.textContent = selectedPhoto.credit;
      rail.querySelectorAll('.dive-photo-preview__thumbnail').forEach(option => {
        option.setAttribute('aria-pressed', String(option === thumbnail));
      });
    });
    dialog.addEventListener('click', event => {
      if (!dialog.open) return;
      const bounds = image.getBoundingClientRect();
      const scale = image.naturalWidth && image.naturalHeight
        ? Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight)
        : 0;
      const photoWidth = image.naturalWidth * scale;
      const photoHeight = image.naturalHeight * scale;
      const photoLeft = bounds.left + (bounds.width - photoWidth) / 2;
      const photoTop = bounds.top + (bounds.height - photoHeight) / 2;
      const clickedPhoto = scale > 0 && event.clientX >= photoLeft && event.clientX <= photoLeft + photoWidth &&
        event.clientY >= photoTop && event.clientY <= photoTop + photoHeight;
      if (!clickedPhoto) dialog.close();
    });

    dialog.addEventListener('close', () => {
      image.removeAttribute('src');
      rail.replaceChildren();
      dialog._diveAtlasPhotos = [];
      dialog._diveAtlasBackgroundPopup?.classList.remove('dive-site-popup--photo-previewing');
      dialog._diveAtlasBackgroundPopup = null;
    });
    document.body.append(dialog);
    return dialog;
  }

  window.DiveAtlasPhotoPreview = {
    open(
      { src, alt, credit, photos, selectedPhotoIndex = 0 },
      { previewLabel = 'Photo preview', closeLabel = 'Close photo preview', popup = null } = {}
    ) {
      const photoOptions = (Array.isArray(photos) && photos.length ? photos : [{ src, alt, credit }])
        .filter(photo => photo && typeof photo.src === 'string' && photo.src);
      if (!photoOptions.length) return;
      const activeDialog = getDialog({ preview: previewLabel, close: closeLabel });
      const image = activeDialog.querySelector('.dive-photo-preview__image');
      const creditElement = activeDialog.querySelector('.dive-photo-preview__credit');
      const rail = activeDialog.querySelector('.dive-photo-preview__rail');
      const initialIndex = Number.isInteger(selectedPhotoIndex)
        ? Math.max(0, Math.min(selectedPhotoIndex, photoOptions.length - 1))
        : 0;
      activeDialog._diveAtlasPhotos = photoOptions.map(photo => ({
        src: photo.src,
        thumbnailSrc: typeof photo.thumbnailSrc === 'string' && photo.thumbnailSrc ? photo.thumbnailSrc : photo.src,
        alt: typeof photo.alt === 'string' ? photo.alt : '',
        credit: typeof photo.credit === 'string' ? photo.credit : ''
      }));
      rail.replaceChildren(...activeDialog._diveAtlasPhotos.map((photo, index) => {
        const thumbnail = document.createElement('button');
        thumbnail.className = 'dive-photo-preview__thumbnail';
        thumbnail.type = 'button';
        thumbnail.dataset.photoIndex = String(index);
        thumbnail.setAttribute('aria-label', `Photo ${index + 1}`);
        thumbnail.setAttribute('aria-pressed', String(index === initialIndex));
        const thumbnailImage = document.createElement('img');
        thumbnailImage.src = photo.thumbnailSrc;
        thumbnailImage.alt = '';
        thumbnailImage.loading = 'lazy';
        thumbnailImage.decoding = 'async';
        thumbnail.append(thumbnailImage);
        return thumbnail;
      }));
      const selectedPhoto = activeDialog._diveAtlasPhotos[initialIndex];
      image.src = selectedPhoto.src;
      image.alt = selectedPhoto.alt;
      creditElement.textContent = selectedPhoto.credit;
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
