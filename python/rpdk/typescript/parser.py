def setup_subparser(subparsers, parents):
    parser = subparsers.add_parser(
        "typescript",
        description="This sub command generates IDE and build files for TypeScript",
        parents=parents,
    )
    parser.set_defaults(language="typescript")

    group = parser.add_mutually_exclusive_group()

    group.add_argument(
        "-d",
        "--use-docker",
        action="store_true",
        help="""Use docker for TypeScript platform-independent packaging.
            This is highly recommended unless you are experienced
            with cross-platform TypeScript packaging.""",
    )

    group.add_argument(
        "--no-docker",
        action="store_true",
        help="""Generally not recommended unless you are experienced
            with cross-platform Typescript packaging.""",
    )

    return parser
