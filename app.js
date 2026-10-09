import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    onAuthStateChanged,
    signOut,
    updateProfile
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
    getFirestore,
    collection,
    addDoc,
    getDocs,
    query,
    orderBy,
    serverTimestamp,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    deleteDoc,
    limit,
    where
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
})[char]);

// Add new games here. Image paths should point to files in your repository.
const games = [
    {
        id: 'pimening',
        name: 'The Pimening',
        desc: "Explore various unique mazes and environments, meet different characters, and discover what a good game looks like.",
        status: 'In development',
        glyph: '✦',
        style: '',
        image: '',
        link: ''
    },
    {
        id: 'cookie-clicker-deluxe',
        name: 'Cookie Clicker But Budget Deluxe',
        desc: 'A simple but good Cookie Clicker-style game with more than meets the eye.',
        status: 'Demo',
        glyph: '⌁',
        style: 'neon',
        image: '',
        link: ''
    },
    {
        id: 'piano-boss-remastered',
        name: 'Piano Boss Fight Remastered',
        desc: 'A retro endless survival boss fight adventure against a sentient piano-try to see how long you will last!',
        status: 'Experiment',
        glyph: '☾',
        style: 'aura',
        image: '',
        link: ''
    }
];

// Staff permissions are enforced by Firestore rules, not by this client list.
// Add staff documents through Firebase Console at staff/USER_UID with { active: true }.
// Never let users grant themselves staff status from this website.
let auth = null;
let db = null;
let user = null;
let firebaseReady = false;
let currentProfile = null;

const hasFirebaseConfig = Boolean(
    firebaseConfig?.apiKey && !firebaseConfig.apiKey.includes('PASTE_')
);

if (hasFirebaseConfig) {
    try {
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        firebaseReady = true;

        onAuthStateChanged(auth, async (signedInUser) => {
            user = signedInUser;
            currentProfile = user ? await getUserProfile(user.uid) : null;
            renderCorner();
            await renderAccount();
            if (document.body.dataset.page === 'community') await loadPosts();
            if (document.body.dataset.page === 'game') await renderGameDetail();
        });
    } catch (error) {
        console.error('Firebase initialization failed:', error);
    }
}

function setStatus(id, message, isError = false) {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = message;
    element.className = `status${isError ? ' error' : ''}`;
}

function formatDate(value) {
    if (!value?.toDate) return 'Just now';
    return value.toDate().toLocaleString();
}

function getDisplayName(profile = currentProfile, authUser = user) {
    return profile?.displayName || authUser?.displayName || 'Member';
}

function getAvatar(profile = currentProfile, authUser = user) {
    return profile?.photoURL || authUser?.photoURL || '';
}

function avatarHTML(name, photoURL, sizeClass = '') {
    const safeName = escapeHTML(name || 'M');
    const image = photoURL
        ? `<img src="${escapeHTML(photoURL)}" alt="${safeName}'s profile picture" loading="lazy">`
        : safeName.slice(0, 1).toUpperCase();
    return `<span class="avatar ${sizeClass}">${image}</span>`;
}

function badgeHTML(badge) {
    const knownBadges = {
        staff: { label: 'Staff', icon: '🛡️' },
        critic: { label: 'Critic', icon: '★' }
    };
    const details = knownBadges[badge];
    return details
        ? `<span class="profile-badge badge-${badge}" title="${details.label}">${details.icon} ${details.label}</span>`
        : '';
}

async function getUserProfile(uid) {
    if (!db || !uid) return null;
    try {
        const snapshot = await getDoc(doc(db, 'profiles', uid));
        return snapshot.exists() ? snapshot.data() : null;
    } catch (error) {
        console.warn('Could not load profile:', error);
        return null;
    }
}

async function ensureProfile(authUser) {
    if (!db || !authUser) return null;
    const ref = doc(db, 'profiles', authUser.uid);
    const snapshot = await getDoc(ref);

    if (!snapshot.exists()) {
        const profile = {
            uid: authUser.uid,
            displayName: authUser.displayName || 'Member',
            photoURL: authUser.photoURL || '',
            createdAt: serverTimestamp(),
            earnedBadges: [],
            selectedBadge: '',
            bio: ''
        };
        await setDoc(ref, profile);
        return { ...profile, createdAt: null };
    }

    const profile = snapshot.data();
    const updates = {};
    if (!profile.displayName && authUser.displayName) updates.displayName = authUser.displayName;
    if (!profile.photoURL && authUser.photoURL) updates.photoURL = authUser.photoURL;

    if (Object.keys(updates).length) {
        await updateDoc(ref, updates);
        return { ...profile, ...updates };
    }
    return profile;
}

async function isStaff(uid = user?.uid) {
    if (!db || !uid) return false;
    try {
        const snapshot = await getDoc(doc(db, 'staff', uid));
        return snapshot.exists() && snapshot.data().active === true;
    } catch {
        return false;
    }
}

function initTheme() {
    const root = document.documentElement;
    const toggle = $('#themeToggle');
    const label = $('#themeLabel');
    if (!toggle || !label) return;

    if (localStorage.getItem('pimincgames-theme') === 'light') {
        root.dataset.theme = 'light';
    }

    const updateThemeLabel = () => {
        const isLight = root.dataset.theme === 'light';
        label.textContent = isLight ? 'Dark' : 'Light';
        toggle.firstChild.textContent = isLight ? '☾ ' : '☼ ';
    };

    updateThemeLabel();
    toggle.addEventListener('click', () => {
        root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
        localStorage.setItem('pimincgames-theme', root.dataset.theme);
        updateThemeLabel();
    });
}

function renderCorner() {
    const corner = $('#authCorner');
    if (!corner) return;

    if (!user) {
        corner.innerHTML = '<a class="btn" href="account.html">Sign in</a>';
        return;
    }

    const name = getDisplayName();
    corner.innerHTML = `
        <a class="row" href="account.html">
            ${avatarHTML(name, getAvatar())}
            <span>${escapeHTML(name)} ${badgeHTML(currentProfile?.selectedBadge)}</span>
        </a>`;
}

async function renderAccount() {
    const panel = $('#accountState');
    if (!panel) return;

    if (!firebaseReady) {
        panel.innerHTML = '<h2>Connect accounts</h2><p class="muted">Finish the Firebase setup to enable accounts.</p>';
        return;
    }

    if (!user) {
        panel.innerHTML = `
            <h2>Welcome</h2>
            <p class="muted">Use Google to sign in. This site never receives your Google password.</p>
            <button class="btn primary" id="login">G &nbsp; Continue with Google</button>
            <div id="authStatus" class="status"></div>`;
        $('#login')?.addEventListener('click', async () => {
            try {
                await signInWithPopup(auth, new GoogleAuthProvider());
            } catch (error) {
                setStatus('authStatus', error.message, true);
            }
        });
        return;
    }

    currentProfile = await ensureProfile(user);
    const name = getDisplayName();
    const photoURL = getAvatar();
    const profileCreated = currentProfile?.createdAt?.toDate
        ? currentProfile.createdAt.toDate().toLocaleDateString()
        : 'Account creation date unavailable';
    const earnedBadges = Array.isArray(currentProfile?.earnedBadges)
        ? currentProfile.earnedBadges
        : [];

    panel.innerHTML = `
        <div class="row">
            ${avatarHTML(name, photoURL)}
            <div>
                <h2>Hi, ${escapeHTML(name)}!</h2>
                <p class="muted">${escapeHTML(user.email || '')}</p>
            </div>
        </div>
        <form id="profileForm" class="form">
            <label>Display name
                <input class="input" id="profileName" maxlength="40" required value="${escapeHTML(name)}">
            </label>
            <label>Profile picture URL
                <input class="input" id="profilePhoto" type="url" maxlength="500" placeholder="https://example.com/avatar.png" value="${escapeHTML(photoURL)}">
            </label>
            <label>About me
                <textarea class="input" id="profileBio" maxlength="300" placeholder="A little about you…">${escapeHTML(currentProfile?.bio || '')}</textarea>
            </label>
            <label>Badge displayed beside your name
                <select class="input" id="selectedBadge">
                    <option value="">No selected badge</option>
                    ${earnedBadges.map((badge) => `<option value="${escapeHTML(badge)}" ${currentProfile?.selectedBadge === badge ? 'selected' : ''}>${escapeHTML(badge)}</option>`).join('')}
                </select>
            </label>
            <button class="btn primary" type="submit">Save profile</button>
            <div id="profileStatus" class="status"></div>
        </form>
        <div class="muted">Member since: ${escapeHTML(profileCreated)}</div>
        <div><strong>Your badges</strong><p>${earnedBadges.length ? earnedBadges.map(badgeHTML).join(' ') : '<span class="muted">No badges earned yet.</span>'}</p></div>
        <p><a class="btn" href="profile.html?id=${encodeURIComponent(user.uid)}">View public profile →</a></p>
        <button class="btn" id="logout" type="button">Sign out</button>`;

    $('#profileForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const displayName = $('#profileName').value.trim();
        const photoURL = $('#profilePhoto').value.trim();
        const bio = $('#profileBio').value.trim();
        const selectedBadge = $('#selectedBadge').value;

        if (!displayName) {
            setStatus('profileStatus', 'Please enter a display name.', true);
            return;
        }
        if (selectedBadge && !earnedBadges.includes(selectedBadge)) {
            setStatus('profileStatus', 'You can only select a badge you have earned.', true);
            return;
        }

        try {
            await updateProfile(user, { displayName, photoURL: photoURL || null });
            await setDoc(doc(db, 'profiles', user.uid), {
                uid: user.uid,
                displayName,
                photoURL,
                bio,
                selectedBadge,
                updatedAt: serverTimestamp()
            }, { merge: true });
            currentProfile = await getUserProfile(user.uid);
            renderCorner();
            setStatus('profileStatus', 'Profile saved.');
            await renderAccount();
        } catch (error) {
            setStatus('profileStatus', error.message, true);
        }
    });

    $('#logout')?.addEventListener('click', () => signOut(auth));
}

async function getRatings(gameId) {
    if (!db) return { average: 0, count: 0, mine: 0 };
    const snapshot = await getDocs(collection(db, 'games', gameId, 'ratings'));
    let total = 0;
    let count = 0;
    let mine = 0;

    snapshot.forEach((ratingDoc) => {
        const value = Number(ratingDoc.data().value) || 0;
        total += value;
        count += 1;
        if (user && ratingDoc.id === user.uid) mine = value;
    });

    return { average: count ? total / count : 0, count, mine };
}

function gameArtwork(game, large = false) {
    const height = large ? 'height:230px;font-size:5rem' : '';
    if (game.image) {
        return `<div class="art ${escapeHTML(game.style)}" style="${height};background-image:url('${escapeHTML(game.image)}');background-size:cover;background-position:center" role="img" aria-label="${escapeHTML(game.name)}"></div>`;
    }
    return `<div class="art ${escapeHTML(game.style)}" style="${height}">${escapeHTML(game.glyph)}</div>`;
}

function gameCard(game, rating = { average: 0, count: 0 }) {
    const detailURL = `game.html?id=${encodeURIComponent(game.id)}`;
    return `
        <article class="card">
            <a href="${detailURL}">${gameArtwork(game)}</a>
            <div class="eyebrow">${escapeHTML(game.status)}</div>
            <h3><a href="${detailURL}">${escapeHTML(game.name)}</a></h3>
            <p>${escapeHTML(game.desc)}</p>
            <div class="cardfoot">
                <span class="stars">${rating.count ? rating.average.toFixed(1) + ' ★' : '— ★'} <span class="muted">(${rating.count})</span></span>
                <a class="btn" href="${detailURL}">Details →</a>
            </div>
        </article>`;
}

async function renderGameLists() {
    for (const containerId of ['featuredGames', 'allGames']) {
        const container = $(`#${containerId}`);
        if (!container) continue;

        container.innerHTML = games.map((game) => gameCard(game)).join('');
        if (!db) continue;

        try {
            const ratings = await Promise.all(games.map((game) => getRatings(game.id)));
            container.innerHTML = games.map((game, index) => gameCard(game, ratings[index])).join('');
        } catch (error) {
            console.warn('Could not load game ratings:', error);
        }
    }
}

async function renderGameDetail() {
    const container = $('#gameDetail');
    if (!container) return;

    const gameId = new URLSearchParams(location.search).get('id');
    const game = games.find((item) => item.id === gameId) || games[0];
    const rating = await getRatings(game.id);
    const reviews = await getGameReviews(game.id);

    container.innerHTML = `
        ${gameArtwork(game, true)}
        <div class="eyebrow">${escapeHTML(game.status)}</div>
        <h1>${escapeHTML(game.name)}<span class="gradient">.</span></h1>
        <p class="lead">${escapeHTML(game.desc)}</p>
        ${game.link ? `<p><a class="btn primary" href="${escapeHTML(game.link)}" target="_blank" rel="noopener noreferrer">Play / Visit game →</a></p>` : ''}
        <div class="panel">
            <h2>Community rating</h2>
            <p><strong>${rating.count ? rating.average.toFixed(1) : '—'} ★</strong> · ${rating.count} member rating(s)</p>
            <p class="muted">${user ? 'Choose a half-star to five-star rating.' : 'Sign in to submit a verified rating. Visitor ratings will be added separately in a later step.'}</p>
            <div id="stars">${[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((value) => `
                <button class="starbtn" data-v="${value}" title="${value} stars" type="button">${rating.mine >= value ? '★' : '☆'}<small>${value}</small></button>
            `).join('')}</div>
            <div id="ratingStatus" class="status">${rating.mine ? 'Your rating: ' + rating.mine + '/5' : ''}</div>
        </div>
        <section class="section">
            <h2>Reviews</h2>
            ${user ? `
                <form id="reviewForm" class="form panel">
                    <label>Your review
                        <textarea class="input" id="reviewBody" maxlength="2000" required placeholder="What did you think of this game?">${escapeHTML(reviews.find((review) => review.uid === user.uid)?.body || '')}</textarea>
                    </label>
                    <label>Rating
                        <select class="input" id="reviewRating" required>
                            ${[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((value) => `<option value="${value}" ${Number(reviews.find((review) => review.uid === user.uid)?.value) === value ? 'selected' : ''}>${value} / 5 stars</option>`).join('')}
                        </select>
                    </label>
                    <button class="btn primary" type="submit">${reviews.some((review) => review.uid === user.uid) ? 'Update review' : 'Publish review'}</button>
                    <div id="reviewStatus" class="status"></div>
                </form>` : '<p class="muted">Sign in to write a review. Visitors cannot post written reviews.</p>'}
            <div id="reviewList">
                ${reviews.length ? reviews.map(renderReview).join('') : '<div class="panel muted">No written reviews yet.</div>'}
            </div>
        </section>
        <a class="btn" href="games.html">← All games</a>`;

    $$('#stars button', container).forEach((button) => {
        button.addEventListener('click', async () => {
            if (!user) {
                setStatus('ratingStatus', 'Sign in to submit a verified rating.', true);
                return;
            }
            try {
                const value = Number(button.dataset.v);
                await setDoc(doc(db, 'games', game.id, 'ratings', user.uid), {
                    uid: user.uid,
                    value,
                    updatedAt: serverTimestamp()
                }, { merge: true });
                await renderGameDetail();
                await renderGameLists();
            } catch (error) {
                setStatus('ratingStatus', error.message, true);
            }
        });
    });

    $('#reviewForm', container)?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const body = $('#reviewBody', container).value.trim();
        const value = Number($('#reviewRating', container).value);
        if (!body) {
            setStatus('reviewStatus', 'Write a few words before publishing.', true);
            return;
        }
        try {
            await setDoc(doc(db, 'games', game.id, 'reviews', user.uid), {
                uid: user.uid,
                displayName: getDisplayName(),
                photoURL: getAvatar(),
                body,
                value,
                updatedAt: serverTimestamp(),
                createdAt: reviews.find((review) => review.uid === user.uid)?.createdAt || serverTimestamp()
            }, { merge: true });
            await renderGameDetail();
        } catch (error) {
            setStatus('reviewStatus', error.message, true);
        }
    });

    container.addEventListener('click', async (event) => {
        const deleteButton = event.target.closest('[data-delete-review]');
        if (!deleteButton || !user) return;
        if (!confirm('Delete your review? This cannot be undone.')) return;
        try {
            await deleteDoc(doc(db, 'games', game.id, 'reviews', user.uid));
            await renderGameDetail();
        } catch (error) {
            alert(`Could not delete review: ${error.message}`);
        }
    }, { once: true });
}

async function getGameReviews(gameId) {
    if (!db) return [];
    try {
        const snapshot = await getDocs(query(
            collection(db, 'games', gameId, 'reviews'),
            orderBy('createdAt', 'desc'),
            limit(100)
        ));
        return snapshot.docs.map((reviewDoc) => ({ id: reviewDoc.id, ...reviewDoc.data() }));
    } catch (error) {
        console.warn('Could not load reviews:', error);
        return [];
    }
}

function renderReview(review) {
    const authorLink = `profile.html?id=${encodeURIComponent(review.uid || '')}`;
    return `
        <article class="post">
            <div class="row">
                ${avatarHTML(review.displayName || 'Member', review.photoURL)}
                <div>
                    <strong><a href="${authorLink}">${escapeHTML(review.displayName || 'Member')}</a></strong>
                    <div class="stars">${escapeHTML(review.value)} / 5 ★</div>
                </div>
            </div>
            <p class="postbody">${escapeHTML(review.body)}</p>
            ${review.editedAt ? '<span class="muted">Edited</span>' : ''}
            ${user && review.uid === user.uid ? '<button class="btn" type="button" data-delete-review>Delete review</button>' : ''}
        </article>`;
}

async function loadPosts() {
    const feed = $('#postFeed');
    if (!feed) return;

    if (!firebaseReady) {
        feed.innerHTML = '<div class="panel">Shared posts become available after Firebase setup.</div>';
        return;
    }

    try {
        const snapshot = await getDocs(query(
            collection(db, 'posts'),
            orderBy('createdAt', 'desc'),
            limit(40)
        ));
        if (snapshot.empty) {
            feed.innerHTML = '<div class="panel">No posts yet. Start the first discussion!</div>';
            return;
        }

        const staffMember = await isStaff();
        feed.innerHTML = snapshot.docs.map((postDoc) => {
            const post = postDoc.data();
            const ownsPost = user && post.uid === user.uid;
            const canModerate = Boolean(staffMember);
            const canEdit = Boolean(ownsPost);
            return `
                <article class="post" data-post-id="${postDoc.id}">
                    <div class="row">
                        ${avatarHTML(post.displayName || 'Member', post.photoURL)}
                        <div>
                            <strong><a href="profile.html?id=${encodeURIComponent(post.uid || '')}">${escapeHTML(post.displayName || 'Member')}</a></strong>
                            <div class="muted">${escapeHTML(formatDate(post.createdAt))}${post.editedAt ? ' · Edited' : ''}</div>
                        </div>
                    </div>
                    <h3 class="post-title">${escapeHTML(post.title)}</h3>
                    <div class="postbody">${escapeHTML(post.body)}</div>
                    ${(canEdit || canModerate) ? `
                        <div class="row post-actions">
                            ${canEdit ? '<button class="btn" type="button" data-edit-post>Edit</button>' : ''}
                            <button class="btn" type="button" data-delete-post>${ownsPost ? 'Delete' : 'Moderate: delete'}</button>
                        </div>` : ''}
                    <div id="comments-${postDoc.id}"><p class="muted">Loading replies…</p></div>
                    <form class="row replyform" data-id="${postDoc.id}" style="margin-top:12px">
                        <input class="input" name="reply" placeholder="${user ? 'Write a reply…' : 'Sign in to reply'}" maxlength="1000" required ${user ? '' : 'disabled'}>
                        <button class="btn" ${user ? '' : 'disabled'}>Reply</button>
                    </form>
                    <div class="status" id="replyStatus-${postDoc.id}"></div>
                </article>`;
        }).join('');

        for (const postDoc of snapshot.docs) {
            const comments = await getDocs(query(
                collection(db, 'posts', postDoc.id, 'comments'),
                orderBy('createdAt', 'asc'),
                limit(25)
            ));
            const target = $(`#comments-${postDoc.id}`);
            if (!target) continue;
            target.innerHTML = comments.docs.map((commentDoc) => {
                const comment = commentDoc.data();
                const canDelete = user && (comment.uid === user.uid || staffMember);
                return `
                    <div class="row reply-item">
                        <p class="muted"><strong><a href="profile.html?id=${encodeURIComponent(comment.uid || '')}">${escapeHTML(comment.displayName || 'Member')}</a>:</strong> ${escapeHTML(comment.body)}${comment.editedAt ? ' <em>(Edited)</em>' : ''}</p>
                        ${canDelete ? `<button class="btn" type="button" data-delete-comment="${commentDoc.id}" data-post="${postDoc.id}">Delete</button>` : ''}
                    </div>`;
            }).join('') || '<p class="muted">No replies yet.</p>';
        }

        feed.querySelectorAll('.replyform').forEach((form) => {
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                if (!user) return;
                const body = form.elements.reply.value.trim();
                if (!body) return;
                try {
                    await addDoc(collection(db, 'posts', form.dataset.id, 'comments'), {
                        body,
                        uid: user.uid,
                        displayName: getDisplayName(),
                        photoURL: getAvatar(),
                        createdAt: serverTimestamp()
                    });
                    await loadPosts();
                } catch (error) {
                    setStatus(`replyStatus-${form.dataset.id}`, error.message, true);
                }
            });
        });

        feed.querySelectorAll('[data-edit-post]').forEach((button) => {
            button.addEventListener('click', async () => {
                const article = button.closest('[data-post-id]');
                const postId = article.dataset.postId;
                const postRef = doc(db, 'posts', postId);
                const postSnapshot = await getDoc(postRef);
                if (!postSnapshot.exists() || postSnapshot.data().uid !== user?.uid) return;
                const oldPost = postSnapshot.data();
                const title = prompt('Edit post title:', oldPost.title);
                if (title === null) return;
                const body = prompt('Edit post message:', oldPost.body);
                if (body === null) return;
                if (!title.trim() || !body.trim()) {
                    alert('Title and message cannot be empty.');
                    return;
                }
                try {
                    await updateDoc(postRef, {
                        title: title.trim().slice(0, 100),
                        body: body.trim().slice(0, 3000),
                        editedAt: serverTimestamp()
                    });
                    await loadPosts();
                } catch (error) {
                    alert(`Could not edit post: ${error.message}`);
                }
            });
        });

        feed.querySelectorAll('[data-delete-post]').forEach((button) => {
            button.addEventListener('click', async () => {
                const article = button.closest('[data-post-id]');
                const postId = article.dataset.postId;
                if (!confirm('Delete this post? This cannot be undone.')) return;
                try {
                    await deleteDoc(doc(db, 'posts', postId));
                    await loadPosts();
                } catch (error) {
                    alert(`Could not delete post. Check your Firestore staff permissions: ${error.message}`);
                }
            });
        });

        feed.querySelectorAll('[data-delete-comment]').forEach((button) => {
            button.addEventListener('click', async () => {
                if (!confirm('Delete this reply?')) return;
                try {
                    await deleteDoc(doc(db, 'posts', button.dataset.post, 'comments', button.dataset.deleteComment));
                    await loadPosts();
                } catch (error) {
                    alert(`Could not delete reply: ${error.message}`);
                }
            });
        });
    } catch (error) {
        feed.innerHTML = '<div class="panel">Could not load feed. Check Firebase setup and Firestore rules.</div>';
        console.error('Community feed error:', error);
    }
}

async function publishPost(event) {
    event.preventDefault();
    if (!firebaseReady) {
        setStatus('postStatus', 'Finish Firebase setup first.', true);
        return;
    }
    if (!user) {
        setStatus('postStatus', 'Sign in before posting.', true);
        return;
    }

    const title = $('#postTitle')?.value.trim() || '';
    const body = $('#postBody')?.value.trim() || '';
    if (!title || !body) {
        setStatus('postStatus', 'Please enter both a title and a message.', true);
        return;
    }

    try {
        await addDoc(collection(db, 'posts'), {
            title: title.slice(0, 100),
            body: body.slice(0, 3000),
            uid: user.uid,
            displayName: getDisplayName(),
            photoURL: getAvatar(),
            createdAt: serverTimestamp()
        });
        $('#postTitle').value = '';
        $('#postBody').value = '';
        setStatus('postStatus', 'Post published.');
        await loadPosts();
    } catch (error) {
        setStatus('postStatus', error.message, true);
    }
}

async function renderPublicProfile() {
    const container = $('#publicProfile');
    if (!container) return;

    const uid = new URLSearchParams(location.search).get('id');
    if (!uid) {
        container.innerHTML = '<div class="panel">No profile was specified.</div>';
        return;
    }

    try {
        const profile = await getUserProfile(uid);
        if (!profile) {
            container.innerHTML = '<div class="panel">Profile not found.</div>';
            return;
        }

        const postsSnapshot = await getDocs(query(
            collection(db, 'posts'),
            where('uid', '==', uid),
            orderBy('createdAt', 'desc'),
            limit(30)
        ));
        const badges = Array.isArray(profile.earnedBadges) ? profile.earnedBadges : [];

        container.innerHTML = `
            <section class="panel">
                <div class="row">
                    ${avatarHTML(profile.displayName || 'Member', profile.photoURL)}
                    <div>
                        <h1>${escapeHTML(profile.displayName || 'Member')}</h1>
                        ${badgeHTML(profile.selectedBadge)}
                    </div>
                </div>
                <p class="muted">${escapeHTML(profile.bio || 'No bio yet.')}</p>
                <p class="muted">Member since: ${escapeHTML(formatDate(profile.createdAt))}</p>
                <h2>Badges</h2>
                <p>${badges.length ? badges.map(badgeHTML).join(' ') : '<span class="muted">No badges earned yet.</span>'}</p>
            </section>
            <section class="section">
                <h2>Community posts</h2>
                ${postsSnapshot.empty ? '<p class="muted">No posts yet.</p>' : postsSnapshot.docs.map((postDoc) => {
                    const post = postDoc.data();
                    return `<article class="post"><h3>${escapeHTML(post.title)}</h3><p class="postbody">${escapeHTML(post.body)}</p><div class="muted">${escapeHTML(formatDate(post.createdAt))}${post.editedAt ? ' · Edited' : ''}</div></article>`;
                }).join('')}
            </section>`;

        const reviews = [];
        for (const game of games) {
            const reviewSnapshot = await getDoc(doc(db, 'games', game.id, 'reviews', uid));
            if (reviewSnapshot.exists()) reviews.push({ ...reviewSnapshot.data(), game });
        }
        const reviewsSection = document.createElement('section');
        reviewsSection.className = 'section';
        reviewsSection.innerHTML = `
            <h2>Game reviews</h2>
            ${reviews.length ? reviews.map((review) => `
                <article class="post">
                    <h3><a href="game.html?id=${encodeURIComponent(review.game.id)}">${escapeHTML(review.game.name)}</a></h3>
                    <div class="stars">${escapeHTML(review.value)} / 5 ★</div>
                    <p class="postbody">${escapeHTML(review.body)}</p>
                </article>`).join('') : '<p class="muted">No game reviews yet.</p>'}`;
        container.appendChild(reviewsSection);
    } catch (error) {
        console.error('Public profile error:', error);
        container.innerHTML = '<div class="panel">Could not load this profile. Check Firestore indexes and rules.</div>';
    }
}

initTheme();
$('#year') && ($('#year').textContent = new Date().getFullYear());
document.querySelector(`[data-nav="${document.body.dataset.page}"]`)?.classList.add('active');
$('#postForm')?.addEventListener('submit', publishPost);

renderCorner();
renderAccount();
renderGameLists();

if (document.body.dataset.page === 'game') renderGameDetail();
if (document.body.dataset.page === 'community') loadPosts();
if (document.body.dataset.page === 'profile') renderPublicProfile();
