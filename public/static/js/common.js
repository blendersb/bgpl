function toggleMobileMenu() {
            const menu = document.getElementById('mobile-menu');
            const icon = document.getElementById('menu-icon');
            if (menu.classList.contains('hidden')) {
                menu.classList.remove('hidden');
                icon.className = 'fa-solid fa-xmark text-lg text-amber-400';
            } else {
                menu.classList.add('hidden');
                icon.className = 'fa-solid fa-bars text-lg';
            }
        }

let alertTimeout = null;

function showAlert(msg, isError = false) {
    const box = document.getElementById('alert-box');
    const textEl = document.getElementById('alert-text');
    const iconEl = document.getElementById('alert-icon');

    // Clear any existing timeout so quick successive alerts don't clip early
    if (alertTimeout) clearTimeout(alertTimeout);

    // Set styling and icons based on state
    if (isError) {
        box.className = "fixed top-5 right-5 z-50 transition-all duration-300 transform translate-y-0 opacity-100 max-w-sm p-4 rounded-xl shadow-2xl text-xs font-bold border bg-rose-950/90 border-rose-500/40 text-rose-300 flex items-center space-x-3 shadow-rose-950/50";
        iconEl.innerHTML = `<i class="fa-solid fa-circle-exclamation text-rose-400 text-sm"></i>`;
    } else {
        box.className = "fixed top-5 right-5 z-50 transition-all duration-300 transform translate-y-0 opacity-100 max-w-sm p-4 rounded-xl shadow-2xl text-xs font-bold border bg-emerald-950/90 border-emerald-500/40 text-emerald-300 flex items-center space-x-3 shadow-emerald-950/50";
        iconEl.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-400 text-sm"></i>`;
    }

    textEl.innerText = msg;
    box.classList.remove('hidden');

    // Automatically hide after 4 seconds with a smooth fade-out
    alertTimeout = setTimeout(() => {
        box.classList.add('opacity-0', 'translate-y-[-10%]');
        setTimeout(() => {
            box.classList.add('hidden');
        }, 300); // Matches transition duration
    }, 4000);
}


function compressImage(file, maxSizeKB = 150, maxWidth = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
        // If file is already smaller than target, return it as-is
        if (file.size <= maxSizeKB * 1024) {
            return resolve(file);
        }

        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Scale down dimensions proportionally if image is too large
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Iteratively reduce quality until under target size
                let currentQuality = quality;
                const attemptCompression = () => {
                    canvas.toBlob((blob) => {
                        if (!blob) {
                            return reject(new Error('Canvas compression failed.'));
                        }

                        if (blob.size <= maxSizeKB * 1024 || currentQuality <= 0.1) {
                            // Convert blob back to a File object
                            const compressedFile = new File([blob], file.name, {
                                type: 'image/jpeg',
                                lastModified: Date.now()
                            });
                            resolve(compressedFile);
                        } else {
                            currentQuality -= 0.1;
                            attemptCompression();
                        }
                    }, 'image/jpeg', currentQuality);
                };

                attemptCompression();
            };
            img.onerror = (error) => reject(error);
        };
        reader.onerror = (error) => reject(error);
    });
}