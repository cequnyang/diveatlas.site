(() => {
  const status = document.getElementById('authMenuStatus');
  const signInLink = document.getElementById('googleSignInLink');
  const signOutButton = document.getElementById('authSignOutButton');
  const toast = document.getElementById('toast');
  if (!status || !signInLink || !signOutButton) return;
  let noticeTimer = null;

  function showNotice(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  const currentUrl = new URL(window.location.href);
  const loginSucceeded = currentUrl.searchParams.get('auth_notice') === 'signed-in';
  if (currentUrl.searchParams.has('auth_notice')) {
    currentUrl.searchParams.delete('auth_notice');
    history.replaceState(history.state, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
  }

  function showSignedOut() {
    window.DiveAtlasCurrentUser = null;
    window.dispatchEvent(new CustomEvent('diveatlas:auth-change', { detail: { user: null } }));
    status.textContent = 'Not signed in';
    signInLink.href = '/api/auth/google';
    signInLink.hidden = false;
    signOutButton.hidden = true;
  }

  function showSignedIn(user) {
    const name = typeof user.name === 'string' ? user.name.trim() : '';
    const email = typeof user.email === 'string' ? user.email.trim() : '';
    window.DiveAtlasCurrentUser = { name, email };
    window.dispatchEvent(new CustomEvent('diveatlas:auth-change', {
      detail: { user: window.DiveAtlasCurrentUser }
    }));
    status.replaceChildren();

    const nameLine = document.createElement('div');
    nameLine.className = 'auth-menu-identity-name';
    nameLine.textContent = name || email || 'Signed in';
    status.append(nameLine);

    if (email && email !== name) {
      const emailLine = document.createElement('div');
      emailLine.className = 'auth-menu-identity-email';
      emailLine.textContent = email;
      status.append(emailLine);
    }
    signInLink.hidden = true;
    signOutButton.hidden = false;
  }

  async function refreshSession() {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('Session lookup failed');
      const payload = await response.json();
      if (payload?.user && typeof payload.user === 'object') {
        showSignedIn(payload.user);
        if (loginSucceeded) showNotice('Signed in with Google successfully.');
      } else {
        showSignedOut();
      }
    } catch {
      status.textContent = 'Account sign-in is unavailable';
      signInLink.removeAttribute('href');
      signInLink.hidden = true;
      signOutButton.hidden = true;
    }
  }

  signOutButton.addEventListener('click', async () => {
    signOutButton.disabled = true;
    status.textContent = 'Signing out…';
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('Sign-out failed');
      showSignedOut();
      showNotice('You have signed out.');
    } catch {
      status.textContent = 'Could not sign out. Please try again.';
    } finally {
      signOutButton.disabled = false;
    }
  });

  refreshSession();
})();
