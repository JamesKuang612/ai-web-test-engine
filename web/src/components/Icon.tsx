import type { ReactNode } from 'react';

export type IconName =
    | 'book'
    | 'braces'
    | 'check'
    | 'chevron-down'
    | 'chevron-right'
    | 'code'
    | 'external-link'
    | 'file-code'
    | 'folder'
    | 'git-branch'
    | 'hammer'
    | 'lightbulb'
    | 'message'
    | 'monitor'
    | 'more-horizontal'
    | 'play'
    | 'plus'
    | 'refresh'
    | 'rotate-left'
    | 'save'
    | 'search'
    | 'sliders'
    | 'sort'
    | 'sparkles'
    | 'undo'
    | 'video'
    | 'workflow';

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
        braces: (
            <>
                <path d="M8 3H6a2 2 0 0 0-2 2v4l-2 3 2 3v4a2 2 0 0 0 2 2h2" />
                <path d="M16 3h2a2 2 0 0 1 2 2v4l2 3-2 3v4a2 2 0 0 1-2 2h-2" />
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
        code: (
            <>
                <path d="m8 9-3 3 3 3" />
                <path d="m16 9 3 3-3 3" />
                <path d="m14 5-4 14" />
            </>
        ),
        'external-link': (
            <>
                <path d="M15 3h6v6" />
                <path d="m10 14 11-11" />
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            </>
        ),
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
        hammer: (
            <>
                <path d="m15 12-8.5 8.5a2.1 2.1 0 0 1-3-3L12 9" />
                <path d="m18 15 4-4" />
                <path d="m17 2 5 5-4 4-5-5Z" />
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
        monitor: (
            <>
                <rect height="14" rx="2" width="20" x="2" y="3" />
                <path d="M8 21h8" />
                <path d="M12 17v4" />
            </>
        ),
        'more-horizontal': (
            <>
                <circle cx="5" cy="12" fill="currentColor" r="1" stroke="none" />
                <circle cx="12" cy="12" fill="currentColor" r="1" stroke="none" />
                <circle cx="19" cy="12" fill="currentColor" r="1" stroke="none" />
            </>
        ),
        play: <path d="m8 5 11 7-11 7Z" />,
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
        'rotate-left': (
            <>
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path d="M3 3v5h5" />
            </>
        ),
        save: (
            <>
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
                <path d="M17 21v-8H7v8" />
                <path d="M7 3v5h8" />
            </>
        ),
        search: (
            <>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-4-4" />
            </>
        ),
        sliders: (
            <>
                <path d="M4 21v-7" />
                <path d="M4 10V3" />
                <path d="M12 21v-9" />
                <path d="M12 8V3" />
                <path d="M20 21v-5" />
                <path d="M20 12V3" />
                <path d="M1 14h6" />
                <path d="M9 8h6" />
                <path d="M17 16h6" />
            </>
        ),
        sort: (
            <>
                <path d="m8 9 4-4 4 4" />
                <path d="m16 15-4 4-4-4" />
            </>
        ),
        sparkles: (
            <>
                <path d="m12 3-1.4 3.6L7 8l3.6 1.4L12 13l1.4-3.6L17 8l-3.6-1.4Z" />
                <path d="m5 14-.8 2.2L2 17l2.2.8L5 20l.8-2.2L8 17l-2.2-.8Z" />
                <path d="m19 14-.6 1.4L17 16l1.4.6L19 18l.6-1.4L21 16l-1.4-.6Z" />
            </>
        ),
        undo: (
            <>
                <path d="M9 7 4 12l5 5" />
                <path d="M20 17a7 7 0 0 0-7-7H4" />
            </>
        ),
        video: (
            <>
                <rect height="14" rx="2" width="15" x="2" y="5" />
                <path d="m17 10 5-3v10l-5-3Z" />
            </>
        ),
        workflow: (
            <>
                <rect height="5" rx="1" width="6" x="9" y="2" />
                <rect height="5" rx="1" width="6" x="2" y="17" />
                <rect height="5" rx="1" width="6" x="16" y="17" />
                <path d="M12 7v5" />
                <path d="M5 17v-2a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v2" />
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
