import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-5xl font-bold text-neutral-300">404</p>
      <h1 className="text-lg font-semibold">Không tìm thấy liên kết này</h1>
      <p className="max-w-sm text-sm text-neutral-500">
        Liên kết có thể đã hết hạn hoặc sản phẩm không còn nữa. Quay lại trang
        chat để tìm deal mới nhé.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-full bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-700"
      >
        Về trang tìm deal
      </Link>
    </main>
  );
}
