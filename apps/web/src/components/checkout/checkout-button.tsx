"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type CheckoutButtonProps = {
  productId: string;
  productTitle: string;
  price: number;
  currency: string;
  variant?: "default" | "large";
  className?: string;
};

type OrderResponse = {
  id: string;
  order_number: string;
  total: number;
  currency: string;
};

type CheckoutResponse = {
  checkout_session_id: string;
  checkout_url: string;
  payment_id: string;
  amount: number;
  currency: string;
};

export function CheckoutButton({ 
  productId, 
  productTitle, 
  price, 
  currency,
  variant = "default",
  className = ""
}: CheckoutButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleCheckout = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const frontendUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || "http://localhost:3000";

      // First, create an order
      const orderResponse = await fetch(`${apiBase}/api/v1/orders/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: [
            {
              product_id: productId,
              product_title: productTitle,
              quantity: 1,
              unit_price: price,
              total_price: price
            }
          ],
          currency: currency.toUpperCase(),
          source: "checkout"
        }),
      });

      if (!orderResponse.ok) {
        throw new Error("Failed to create order");
      }

      const order: OrderResponse = await orderResponse.json();

      // Then, create a checkout session
      const checkoutResponse = await fetch(`${apiBase}/api/v1/payments/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          order_id: order.id,
          success_url: `${frontendUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}&order_id=${order.id}`,
          cancel_url: `${frontendUrl}/checkout/cancelled?order_id=${order.id}`,
        }),
      });

      if (!checkoutResponse.ok) {
        throw new Error("Failed to create checkout session");
      }

      const checkout: CheckoutResponse = await checkoutResponse.json();

      // Redirect to Stripe Checkout
      window.location.href = checkout.checkout_url;

    } catch (err) {
      console.error("Checkout error:", err);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  const baseClasses = "inline-flex items-center justify-center rounded-full font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed";
  
  const variantClasses = {
    default: "bg-white text-black hover:bg-white/90 px-6 py-2 text-sm",
    large: "bg-white text-black hover:bg-white/90 px-8 py-3 text-base"
  };

  const buttonClasses = `${baseClasses} ${variantClasses[variant]} ${className}`;

  return (
    <div className="space-y-2">
      <button
        onClick={handleCheckout}
        disabled={isLoading}
        className={buttonClasses}
      >
        {isLoading ? (
          <>
            <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24">
              <circle 
                className="opacity-25" 
                cx="12" 
                cy="12" 
                r="10" 
                stroke="currentColor" 
                strokeWidth="4"
                fill="none"
              />
              <path 
                className="opacity-75" 
                fill="currentColor" 
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Processing...
          </>
        ) : (
          `Buy Now - ${currency} ${price.toLocaleString()}`
        )}
      </button>
      
      {error && (
        <p className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}