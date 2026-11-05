/**
 * Small dense linear algebra for the orbital solvers.
 * Matrices are row-major Float64Array of size n*n.
 */

export interface EigenResult {
    /** Eigenvalues in ascending order. */
    values: Float64Array;
    /** Eigenvectors as columns: vectors[i * n + k] is component i of vector k. */
    vectors: Float64Array;
}

/**
 * Symmetric eigen-decomposition: Householder tridiagonalisation followed by
 * implicit QL (the classic tred2/tql2 pair, as in EISPACK/JAMA).
 * O(n^3); a few hundred basis functions take well under a second.
 */
export function symmetricEigen(A: Float64Array, n: number): EigenResult {
    const V = new Float64Array(A);
    const d = new Float64Array(n);
    const e = new Float64Array(n);
    // Logical V(i, j) is stored transposed at V[j * n + i]: tred2's inner loops run
    // down columns, which then become contiguous memory. A is symmetric, so the
    // initial copy is already in this layout.
    const v = (i: number, j: number) => V[j * n + i];
    const set = (i: number, j: number, x: number) => { V[j * n + i] = x; };

    // --- tred2 ---
    for (let j = 0; j < n; j++) d[j] = v(n - 1, j);
    for (let i = n - 1; i > 0; i--) {
        let scale = 0, h = 0;
        for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
        if (scale === 0) {
            e[i] = d[i - 1];
            for (let j = 0; j < i; j++) {
                d[j] = v(i - 1, j);
                set(i, j, 0);
                set(j, i, 0);
            }
        } else {
            for (let k = 0; k < i; k++) {
                d[k] /= scale;
                h += d[k] * d[k];
            }
            let f = d[i - 1];
            let g = Math.sqrt(h);
            if (f > 0) g = -g;
            e[i] = scale * g;
            h -= f * g;
            d[i - 1] = f - g;
            for (let j = 0; j < i; j++) e[j] = 0;
            for (let j = 0; j < i; j++) {
                f = d[j];
                set(j, i, f);
                g = e[j] + v(j, j) * f;
                for (let k = j + 1; k <= i - 1; k++) {
                    g += v(k, j) * d[k];
                    e[k] += v(k, j) * f;
                }
                e[j] = g;
            }
            f = 0;
            for (let j = 0; j < i; j++) {
                e[j] /= h;
                f += e[j] * d[j];
            }
            const hh = f / (h + h);
            for (let j = 0; j < i; j++) e[j] -= hh * d[j];
            for (let j = 0; j < i; j++) {
                f = d[j];
                g = e[j];
                for (let k = j; k <= i - 1; k++) {
                    set(k, j, v(k, j) - (f * e[k] + g * d[k]));
                }
                d[j] = v(i - 1, j);
                set(i, j, 0);
            }
        }
        d[i] = h;
    }
    for (let i = 0; i < n - 1; i++) {
        set(n - 1, i, v(i, i));
        set(i, i, 1);
        const h = d[i + 1];
        if (h !== 0) {
            for (let k = 0; k <= i; k++) d[k] = v(k, i + 1) / h;
            for (let j = 0; j <= i; j++) {
                let g = 0;
                for (let k = 0; k <= i; k++) g += v(k, i + 1) * v(k, j);
                for (let k = 0; k <= i; k++) set(k, j, v(k, j) - g * d[k]);
            }
        }
        for (let k = 0; k <= i; k++) set(k, i + 1, 0);
    }
    for (let j = 0; j < n; j++) {
        d[j] = v(n - 1, j);
        set(n - 1, j, 0);
    }
    set(n - 1, n - 1, 1);
    e[0] = 0;

    // --- tql2 ---
    // Work on W = V^T so each Givens rotation updates two contiguous rows
    // instead of two strided columns (several times faster for n in the hundreds).
    const W = V; // already V^T in memory
    for (let i = 1; i < n; i++) e[i - 1] = e[i];
    e[n - 1] = 0;
    let f = 0, tst1 = 0;
    const eps = Math.pow(2, -52);
    for (let l = 0; l < n; l++) {
        tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
        let m = l;
        while (m < n) {
            if (Math.abs(e[m]) <= eps * tst1) break;
            m++;
        }
        if (m > l) {
            let iter = 0;
            do {
                if (++iter > 200) throw new Error('Eigen-solver did not converge');
                let g = d[l];
                let p = (d[l + 1] - g) / (2 * e[l]);
                let r = Math.hypot(p, 1);
                if (p < 0) r = -r;
                d[l] = e[l] / (p + r);
                d[l + 1] = e[l] * (p + r);
                const dl1 = d[l + 1];
                let h = g - d[l];
                for (let i = l + 2; i < n; i++) d[i] -= h;
                f += h;
                p = d[m];
                let c = 1, c2 = c, c3 = c;
                const el1 = e[l + 1];
                let s = 0, s2 = 0;
                for (let i = m - 1; i >= l; i--) {
                    c3 = c2;
                    c2 = c;
                    s2 = s;
                    g = c * e[i];
                    h = c * p;
                    r = Math.hypot(p, e[i]);
                    e[i + 1] = s * r;
                    s = e[i] / r;
                    c = p / r;
                    p = c * d[i] - s * g;
                    d[i + 1] = h + s * (c * g + s * d[i]);
                    const ri = i * n, ri1 = (i + 1) * n;
                    for (let k = 0; k < n; k++) {
                        h = W[ri1 + k];
                        const wk = W[ri + k];
                        W[ri1 + k] = s * wk + c * h;
                        W[ri + k] = c * wk - s * h;
                    }
                }
                p = -s * s2 * c3 * el1 * e[l] / dl1;
                e[l] = s * p;
                d[l] = c * p;
            } while (Math.abs(e[l]) > eps * tst1);
        }
        d[l] += f;
        e[l] = 0;
    }

    // Sort ascending.
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => d[a] - d[b]);
    const values = new Float64Array(n);
    const vectors = new Float64Array(n * n);
    order.forEach((src, k) => {
        values[k] = d[src];
        const ro = src * n;
        for (let i = 0; i < n; i++) vectors[i * n + k] = W[ro + i];
    });
    return { values, vectors };
}

/** C = A * B for square n×n row-major matrices. */
export function matMul(A: Float64Array, B: Float64Array, n: number): Float64Array {
    const C = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
        for (let k = 0; k < n; k++) {
            const a = A[i * n + k];
            if (a === 0) continue;
            const bo = k * n, co = i * n;
            for (let j = 0; j < n; j++) C[co + j] += a * B[bo + j];
        }
    }
    return C;
}

/**
 * Solve the generalised symmetric problem H C = S C E by Cholesky reduction:
 * S = L L^T, solve (L^-1 H L^-T) y = e y, then C = L^-T y.
 * Returns eigenvalues ascending and S-orthonormal eigenvectors as columns.
 */
export function generalizedEigen(H: Float64Array, S: Float64Array, n: number): EigenResult {
    // Cholesky, lower triangle (row-major).
    const L = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
        const io = i * n;
        for (let j = 0; j <= i; j++) {
            const jo = j * n;
            let sum = S[io + j];
            for (let k = 0; k < j; k++) sum -= L[io + k] * L[jo + k];
            if (i === j) {
                if (sum <= 1e-10) throw new Error('Overlap matrix is singular (atoms on top of each other?)');
                L[io + i] = Math.sqrt(sum);
            } else {
                L[io + j] = sum / L[jo + j];
            }
        }
    }

    // Y = L^-1 H  (forward substitution on each column of H, done row-wise).
    const Y = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
        const io = i * n;
        for (let c = 0; c < n; c++) Y[io + c] = H[io + c];
        for (let k = 0; k < i; k++) {
            const l = L[io + k];
            if (l === 0) continue;
            const ko = k * n;
            for (let c = 0; c < n; c++) Y[io + c] -= l * Y[ko + c];
        }
        const d = 1 / L[io + i];
        for (let c = 0; c < n; c++) Y[io + c] *= d;
    }
    // Hp = Y L^-T = (L^-1 Y^T)^T; Y^T = H L^-T, and Hp is symmetric, so solve on Y^T rows.
    const Yt = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) Yt[j * n + i] = Y[i * n + j];
    const Hp = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
        const io = i * n;
        for (let c = 0; c < n; c++) Hp[io + c] = Yt[io + c];
        for (let k = 0; k < i; k++) {
            const l = L[io + k];
            if (l === 0) continue;
            const ko = k * n;
            for (let c = 0; c < n; c++) Hp[io + c] -= l * Hp[ko + c];
        }
        const d = 1 / L[io + i];
        for (let c = 0; c < n; c++) Hp[io + c] *= d;
    }
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const m = 0.5 * (Hp[i * n + j] + Hp[j * n + i]);
            Hp[i * n + j] = m;
            Hp[j * n + i] = m;
        }
    }

    const h = symmetricEigen(Hp, n);

    // C = L^-T y: back substitution, all eigenvector columns at once.
    const C = new Float64Array(h.vectors);
    for (let i = n - 1; i >= 0; i--) {
        const io = i * n;
        for (let k = i + 1; k < n; k++) {
            const l = L[k * n + i];
            if (l === 0) continue;
            const ko = k * n;
            for (let c = 0; c < n; c++) C[io + c] -= l * C[ko + c];
        }
        const d = 1 / L[io + i];
        for (let c = 0; c < n; c++) C[io + c] *= d;
    }
    return { values: h.values, vectors: C };
}
