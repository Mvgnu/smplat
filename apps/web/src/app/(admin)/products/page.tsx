"use server";

import { revalidatePath } from "next/cache";

type ProductRecord = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  category: string;
  base_price?: number;
  basePrice?: number;
  currency?: string;
  status?: string;
};

const apiBase = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function fetchProducts(): Promise<ProductRecord[]> {
  const response = await fetch(`${apiBase}/api/v1/products/`, { cache: "no-store" });
  if (!response.ok) {
    return [];
  }
  return response.json();
}

async function createProduct(formData: FormData) {
  "use server";

  const payload = {
    slug: formData.get("slug"),
    title: formData.get("title"),
    category: formData.get("category"),
    basePrice: Number(formData.get("basePrice")),
    currency: formData.get("currency") ?? "EUR",
    status: formData.get("status") ?? "ACTIVE",
    description: formData.get("description") ?? null
  };

  const response = await fetch(`${apiBase}/api/v1/products/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  revalidatePath("/admin/services");
}

async function updateProduct(formData: FormData) {
  "use server";

  const productId = formData.get("productId");
  if (!productId) {
    throw new Error("Missing product ID");
  }

  const payload = {
    title: formData.get("title") || undefined,
    description: formData.get("description") || undefined,
    basePrice: formData.get("basePrice") ? Number(formData.get("basePrice")) : undefined,
    currency: formData.get("currency") || undefined,
    status: formData.get("status") || undefined
  };

  const response = await fetch(`${apiBase}/api/v1/products/${productId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  revalidatePath("/admin/services");
}

async function deleteProduct(formData: FormData) {
  "use server";
  const productId = formData.get("productId");
  if (!productId) {
    throw new Error("Missing product ID");
  }

  const response = await fetch(`${apiBase}/api/v1/products/${productId}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  revalidatePath("/admin/services");
}

export default async function AdminProductsPage() {
  const products = await fetchProducts();

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-16 text-white">
      <header>
        <p className="uppercase tracking-[0.3em] text-xs text-white/50">Operations</p>
        <h1 className="mt-2 text-3xl font-semibold">Product catalogue</h1>
        <p className="mt-3 text-white/70">Create storefront SKUs that map to automated fulfillment workflows.</p>
      </header>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
        <h2 className="text-xl font-semibold">Create product</h2>
        <form action={createProduct} className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm text-white/80">
            Slug
            <input required name="slug" className="rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-white focus:border-white/40 focus:outline-none" placeholder="instagram-growth" />
          </label>
          <label className="flex flex-col gap-2 text-sm text-white/80">
            Title
            <input required name="title" className="rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-white focus:border-white/40 focus:outline-none" placeholder="Instagram Growth Campaign" />
          </label>
          <label className="flex flex-col gap-2 text-sm text-white/80">
            Category
            <input required name="category" className="rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-white focus:border-white/40 focus:outline-none" placeholder="instagram" />
          </label>
          <label className="flex flex-col gap-2 text-sm text-white/80">
            Base price (EUR)
            <input required name="basePrice" type="number" className="rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-white focus:border-white/40 focus:outline-none" placeholder="299" />
          </label>
          <label className="flex flex-col gap-2 text-sm text-white/80">
            Currency
            <input name="currency" defaultValue="EUR" className="rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-white focus:border-white/40 focus:outline-none" />
          </label>
          <label className="flex flex-col gap-2 text-sm text-white/80">
            Status
            <select name="status" defaultValue="ACTIVE" className="rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-white focus:border-white/40 focus:outline-none">
              <option value="ACTIVE">Active</option>
              <option value="DRAFT">Draft</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </label>
          <label className="md:col-span-2 flex flex-col gap-2 text-sm text-white/80">
            Description
            <textarea name="description" rows={3} className="rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-white focus:border-white/40 focus:outline-none" placeholder="Outline deliverables, delivery speed, and requirements." />
          </label>
          <div className="md:col-span-2 flex justify-end">
            <button type="submit" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/80">
              Save product
            </button>
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Existing products</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] divide-y divide-white/10 text-left text-sm">
            <thead className="text-white/60">
              <tr>
                <th className="py-3">Title</th>
                <th className="py-3">Slug</th>
                <th className="py-3">Category</th>
                <th className="py-3">Price</th>
                <th className="py-3">Status</th>
                <th className="py-3" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {products.map((product) => (
                <tr key={product.id}>
                  <td className="py-3 font-medium text-white">{product.title}</td>
                  <td className="py-3 text-white/60">{product.slug}</td>
                  <td className="py-3 text-white/60">{product.category}</td>
                  <td className="py-3 text-white/60">
                    {(product.currency ?? "EUR")} {(product.base_price ?? product.basePrice ?? 0).toLocaleString()}
                  </td>
                  <td className="py-3 text-white/60">{product.status}</td>
                  <td className="py-3">
                    <form action={updateProduct} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="productId" value={product.id} />
                      <label className="flex flex-col text-xs text-white/60">
                        Title
                        <input name="title" defaultValue={product.title} className="rounded border border-white/10 bg-black/40 px-2 py-1 text-white focus:border-white/40 focus:outline-none" />
                      </label>
                      <label className="flex flex-col text-xs text-white/60">
                        Price
                        <input name="basePrice" type="number" defaultValue={product.base_price ?? product.basePrice ?? 0} className="w-24 rounded border border-white/10 bg-black/40 px-2 py-1 text-white focus:border-white/40 focus:outline-none" />
                      </label>
                      <label className="flex flex-col text-xs text-white/60">
                        Status
                        <select name="status" defaultValue={product.status ?? "ACTIVE"} className="rounded border border-white/10 bg-black/40 px-2 py-1 text-white focus:border-white/40 focus:outline-none">
                          <option value="ACTIVE">Active</option>
                          <option value="DRAFT">Draft</option>
                          <option value="ARCHIVED">Archived</option>
                        </select>
                      </label>
                      <button type="submit" className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black transition hover:bg-white/80">
                        Update
                      </button>
                    </form>
                    <form action={deleteProduct} className="mt-2 inline-flex" method="post">
                      <input type="hidden" name="productId" value={product.id} />
                      <button type="submit" className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white/70 transition hover:border-white/40">
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
