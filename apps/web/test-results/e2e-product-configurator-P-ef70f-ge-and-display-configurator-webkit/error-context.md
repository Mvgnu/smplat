# Page snapshot

```yaml
- generic [active]:
  - alert [ref=e1]
  - dialog "Failed to compile" [ref=e4]:
    - generic [ref=e5]:
      - heading "Failed to compile" [level=4] [ref=e7]
      - generic [ref=e8]:
        - generic [ref=e10]: "src/app/(admin)/products/page.tsx You cannot have two parallel pages that resolve to the same path. Please check /(admin)/products/page and /(storefront)/products/page. Refer to the route group docs for more information: https://nextjs.org/docs/app/building-your-application/routing/route-groups"
        - contentinfo [ref=e11]:
          - paragraph [ref=e12]: This error occurred during the build process and can only be dismissed by fixing the error.
```