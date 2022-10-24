def setup_subparser(subparsers, parents):
    parser = subparsers.add_parser(
        "typescript",
        description="This sub command generates IDE and build files for TypeScript",
        parents=parents,
    )
    parser.set_defaults(language="typescript")

    parser.add_argument(
        "-d",
        "--use-docker",
        action="store_true",
        help="""Use docker for TypeScript platform-independent packaging.
            This is highly recommended unless you are experienced
            with cross-platform TypeScript packaging.""",
    )

    return parser