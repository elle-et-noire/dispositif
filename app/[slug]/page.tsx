import { GetAllPostSlugs, GetPostBySlug } from "@/lib/post";
import { MDXRemote } from "next-mdx-remote/rsc";

interface PostPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export async function generateStaticParams() {
  const slugs = GetAllPostSlugs();
  return slugs.map((slug) => ({ params: { slug } }));
}

export default async function PostPage(props: PostPageProps) {
  const params = await props.params;
  const { content, data } = GetPostBySlug(params.slug);

  return (
    <div>
      <h1>{data.title}</h1>
      <p>{data.category}</p>
      <div>
        <MDXRemote source={content} />
      </div>
    </div>
  );
}
