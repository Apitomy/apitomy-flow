package io.apitomy.flow.model;

import java.lang.ref.ReferenceQueue;
import java.lang.ref.WeakReference;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Function;

/**
 * Weak, identity-keyed memoization for immutable owners. Values must never retain their owner.
 * Unlike WeakHashMap this does not hash or compare an entire definition (or opaque config values).
 */
public final class WeakIdentityCache<K, V> {
    private final ReferenceQueue<K> collected = new ReferenceQueue<>();
    private final Map<Key<K>, V> values = new HashMap<>();

    /** Returns the owner's value, computing and publishing it once under the cache lock. */
    public synchronized V get(K owner, Function<K, V> factory) {
        Object expired;
        while ((expired = collected.poll()) != null) values.remove(expired);
        Key<K> lookup = new Key<>(owner, collected);
        V value = values.get(lookup);
        if (value == null) {
            value = factory.apply(owner);
            values.put(lookup, value);
        }
        return value;
    }

    private static final class Key<K> extends WeakReference<K> {
        private final int hash;

        private Key(K owner, ReferenceQueue<K> queue) {
            super(owner, queue);
            hash = System.identityHashCode(owner);
        }

        /** Uses identity hashing without traversing the immutable owner's contents. */
        @Override
        public int hashCode() { return hash; }

        /** Cleared keys only equal themselves, allowing reference-queue eviction. */
        @Override
        public boolean equals(Object other) {
            return this == other || other instanceof Key<?> key && get() != null && get() == key.get();
        }
    }
}
