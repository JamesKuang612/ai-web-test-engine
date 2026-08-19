import type { ReactNode } from 'react';

export type IconName =
    | 'book'
    | 'check'
    | 'chevron-down'
    | 'chevron-right'
    | 'file-code'
    | 'folder'
    | 'git-branch'
    | 'lightbulb'
    | 'message'
    | 'plus'
    | 'refresh'
    | 'search'
    | 'sort';

interface IconProps {
    className?: string;
    name: IconName;
    size?: number;
}

export function Icon({ className, name, size = 18 }: IconProps) {
    const paths = {
        book: (
            <>
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
            </>
        ),
        check: (
            <>
                <circle cx="12" cy="12" r="9" />
                <path d="m8 12 2.6 2.6L16.5 9" />
            </>
        ),
        'chevron-down': <path d="m8 10 4 4 4-4" />,
        'chevron-right': <path d="m10 8 4 4-4 4" />,
        'file-code': (
            <>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                <path d="M14 2v6h6" />
                <path d="m10 13-2 2 2 2" />
                <path d="m14 13 2 2-2 2" />
            </>
        ),
        folder: <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
        'git-branch': (
            <>
                <circle cx="6" cy="5" r="2" />
                <circle cx="18" cy="6" r="2" />
                <circle cx="6" cy="19" r="2" />
                <path d="M6 7v10" />
                <path d="M8 7c5 0 3 5 8 5h2" />
            </>
        ),
        lightbulb: (
            <>
                <path d="M9 18h6" />
                <path d="M10 22h4" />
                <path d="M8.7 15.6A7 7 0 1 1 15.3 15.6c-.8.5-1.3 1.4-1.3 2.4h-4c0-1-.5-1.9-1.3-2.4Z" />
            </>
        ),
        message: (
            <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
        ),
        plus: (
            <>
                <path d="M12 5v14" />
                <path d="M5 12h14" />
            </>
        ),
        refresh: (
            <>
                <path d="M20 11a8.1 8.1 0 1 0 .4 4" />
                <path d="M20 4v7h-7" />
            </>
        ),
        search: (
            <>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-4-4" />
            </>
        ),
        sort: (
            <>
                <path d="m8 9 4-4 4 4" />
                <path d="m16 15-4 4-4-4" />
            </>
        )
    } satisfies Record<IconName, ReactNode>;

    return (
        <svg
            aria-hidden="true"
            className={className}
            fill="none"
            height={size}
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
            width={size}
        >
            {paths[name]}
        </svg>
    );
}
